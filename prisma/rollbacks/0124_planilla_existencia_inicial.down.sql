-- Rollback of 0124_planilla_existencia_inicial (apply as a NEW forward migration).
-- Only possible while NO correccion inicial movement exists.
-- The enum values CORRECCION_INICIAL_SUMA and CORRECCION_INICIAL_RESTA stay
-- (Postgres cannot drop enum values); with no rows using them, they are inert.
-- See docs/rollbacks/planilla-existencia-inicial.md.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.movimiento_stock WHERE tipo::text IN ('CORRECCION_INICIAL_SUMA', 'CORRECCION_INICIAL_RESTA')) THEN
    RAISE EXCEPTION 'Rollback 0124: corrección inicial movements exist -- cannot rollback';
  END IF;

  IF EXISTS (SELECT 1 FROM fsj.partida WHERE cantidad_inicial <= 0) THEN
    RAISE EXCEPTION 'Rollback 0124: partidas with cantidad_inicial <= 0 exist -- cannot rollback';
  END IF;
END $$;

-- 1. Drop movement validation trigger & function
DROP TRIGGER IF EXISTS trg_movimiento_stock_validar_correccion_inicial ON fsj.movimiento_stock;
DROP FUNCTION IF EXISTS fsj.movimiento_stock_validar_correccion_inicial();

-- 2. Drop relevamiento_fila table & related objects
DROP TABLE IF EXISTS fsj.relevamiento_fila CASCADE;
DROP FUNCTION IF EXISTS fsj.relevamiento_fila_validar_abierto();

-- 3. Restore fsj.movimiento_stock_aplicar to 0111 body
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_aplicar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_delta               numeric;
  v_fecha_vencimiento    date;
BEGIN
  IF NEW.tipo::text IN ('INGRESO_COMPRA', 'INGRESO_INICIAL', 'INGRESO_ELABORACION') THEN
    v_delta := NEW.cantidad;
  ELSE
    v_delta := -NEW.cantidad;
  END IF;

  IF NEW.tipo::text IN ('EGRESO_PREPARACION', 'EGRESO_ELABORACION') THEN
    SELECT fecha_vencimiento_vigente INTO v_fecha_vencimiento
    FROM fsj.partida WHERE id = NEW.partida_id;

    IF v_fecha_vencimiento < fsj.jornada_actual(NEW.tenant_id) THEN
      RAISE EXCEPTION 'INV-S10: cannot register % against expired partida % (fecha_vencimiento_vigente %)',
        NEW.tipo, NEW.partida_id, v_fecha_vencimiento
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('fsj.mov', 'on', true);

  UPDATE fsj.partida
  SET cantidad_disponible = cantidad_disponible + v_delta,
      fecha_apertura = CASE
        WHEN NEW.tipo::text IN ('EGRESO_PREPARACION', 'EGRESO_ELABORACION') AND fecha_apertura IS NULL THEN NEW.registrado_en
        ELSE fecha_apertura
      END
  WHERE id = NEW.partida_id;

  PERFORM set_config('fsj.mov', 'off', true);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.movimiento_stock_aplicar() IS
  'INV-S01/S04, INV-S16/S17, INV-S10. 0014: fsj.jornada_actual(tenant_id) instead of current_date. 0074: INV-S10 reads partida.fecha_vencimiento_vigente (the latest reanálisis, else fecha_vencimiento). 0100: INGRESO_INICIAL adds, like INGRESO_COMPRA. 0111: INGRESO_ELABORACION adds; EGRESO_ELABORACION is refused on an expired partida and opens it, like EGRESO_PREPARACION.';

-- 4. Restore fsj.partida_validar_update to 0074 body
CREATE OR REPLACE FUNCTION fsj.partida_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cantidad_disponible IS DISTINCT FROM OLD.cantidad_disponible
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S01: partida.cantidad_disponible can only be changed by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S17: once set, fecha_apertura never changes again (not even via
  -- the movimiento trigger).
  IF OLD.fecha_apertura IS NOT NULL AND NEW.fecha_apertura IS DISTINCT FROM OLD.fecha_apertura THEN
    RAISE EXCEPTION 'INV-S17: partida.fecha_apertura cannot change once set'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S16: the NULL -> value transition itself is also trigger-only.
  IF OLD.fecha_apertura IS NULL AND NEW.fecha_apertura IS NOT NULL
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S16: partida.fecha_apertura can only be set by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S23 (0074): the original expiry is never rewritten; the vigente one
  -- only moves through a reanálisis.
  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento cannot change (a reanálisis is recorded in fsj.reanalisis_partida)'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.fecha_vencimiento_vigente IS DISTINCT FROM OLD.fecha_vencimiento_vigente
     AND coalesce(current_setting('fsj.reanalisis', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento_vigente can only be changed by a reanalisis_partida insert'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.partida_validar_update() IS
  'INV-S01/S04, INV-S16/S17 (0008) and INV-S23 (0074): cantidad_disponible / fecha_apertura only through fsj.movimiento_stock_aplicar(), fecha_vencimiento never, fecha_vencimiento_vigente only through fsj.reanalisis_partida_aplicar().';

-- 5. Restore partida_cantidad_inicial_check
ALTER TABLE fsj.partida
  DROP CONSTRAINT IF EXISTS partida_cantidad_inicial_check;

ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_cantidad_inicial_check
  CHECK (cantidad_inicial > 0);

-- 6. Restore fsj.movimiento_stock_validar_contralor to 0100 body
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_contralor(p_tenant_id uuid, p_movimiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_mov          fsj.movimiento_stock%ROWTYPE;
  v_activacion   timestamptz;
  v_tipo_control fsj.tipo_control;
BEGIN
  SELECT * INTO v_mov FROM fsj.movimiento_stock WHERE tenant_id = p_tenant_id AND id = p_movimiento_id;

  IF v_mov.tipo::text = 'INGRESO_INICIAL' THEN
    RETURN;
  END IF;

  SELECT fecha_activacion_contralor INTO v_activacion FROM fsj.tenant WHERE id = p_tenant_id;
  IF v_activacion IS NULL OR v_mov.registrado_en < v_activacion THEN
    RETURN;
  END IF;

  SELECT d.tipo_control INTO v_tipo_control
  FROM fsj.partida p
  JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
  WHERE p.tenant_id = p_tenant_id AND p.id = v_mov.partida_id;

  IF v_tipo_control IS NULL OR v_tipo_control = 'NINGUNO' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fsj.asiento_contralor WHERE tenant_id = p_tenant_id AND movimiento_stock_id = p_movimiento_id) THEN
    RAISE EXCEPTION 'INV-L08: movimiento_stock % on controlled droga (tipo_control %) requires a matching asiento_contralor', p_movimiento_id, v_tipo_control
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.movimiento_stock_validar_contralor(uuid, uuid) IS
  'INV-L08 (0014). 0100: an INGRESO_INICIAL is exempt -- the droga''s APERTURA asiento already holds that stock (docs/specs/existencia-inicial.md R8).';

-- 7. Restore fsj.plantilla_rol_permisos to 0111 body and remove permission
CREATE OR REPLACE FUNCTION fsj.plantilla_rol_permisos()
RETURNS TABLE (rol_codigo text, permiso_codigo text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT m.rol_codigo, c.permiso_codigo
  FROM (VALUES
    ('DIRECTOR_TECNICO', ARRAY[
      'archivo.destruccion.gestionar', 'archivo.lotes.gestionar', 'auditoria.ver',
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.firmar', 'cierres.folio.corregir', 'cierres.imprimir', 'cierres.reporte', 'cierres.ver',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'drogas.baja', 'drogas.crear', 'drogas.editar', 'drogas.reactivar',
      'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.autorizar', 'libro.anulacion.solicitar', 'libro.exportar', 'libro.ver',
      'libros.cerrar', 'libros.crear',
      'medicos.gestionar', 'pacientes.gestionar', 'precios.reglas.editar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.autorizar', 'stock.ajuste.registrar', 'stock.partida.costo.corregir', 'stock.partida.ingresar',
      'stock.partida.potencia.corregir',
      'stock.valorizado.ver', 'stock.ver',
      'usuarios.auditoria.ver'
    ]),
    ('FARMACEUTICO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.imprimir', 'cierres.reporte', 'cierres.ver',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'drogas.baja', 'drogas.crear', 'drogas.editar', 'drogas.reactivar',
      'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.solicitar', 'libro.exportar', 'libro.ver',
      'medicos.gestionar', 'pacientes.gestionar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.registrar', 'stock.partida.ingresar', 'stock.valorizado.ver', 'stock.ver'
    ])
  ) AS m(rol_codigo, permisos)
  CROSS JOIN LATERAL unnest(m.permisos) AS c(permiso_codigo);
$$;

DELETE FROM fsj.rol_permiso WHERE permiso_id IN (SELECT id FROM fsj.permiso WHERE codigo = 'stock.relevamiento.editar');
DELETE FROM fsj.permiso WHERE codigo = 'stock.relevamiento.editar';
