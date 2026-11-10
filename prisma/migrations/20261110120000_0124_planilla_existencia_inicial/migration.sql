-- 0124_planilla_existencia_inicial
--
-- docs/specs/existencia-inicial.md, change openspec/changes/planilla-existencia-inicial/.
-- Separates counting from creating stock:
--   1. fsj.relevamiento_fila: editable draft (planilla) of rows before passing to stock.
--      RLS enabled and forced (fsj.setup_tenant_table), table-level SELECT/INSERT/UPDATE/DELETE
--      for fsj_app, INV-U07 actor guard on creado_por_id, and a BEFORE INSERT OR UPDATE trigger
--      refusing edits when the relevamiento inicial is closed.
--   2. fsj.tipo_movimiento gains CORRECCION_INICIAL_SUMA and CORRECCION_INICIAL_RESTA:
--      referenced only inside plpgsql bodies (evaluated at runtime), safe in this same transaction.
--   3. fsj.movimiento_stock_aplicar: sums add, restas subtract, and both move cantidad_inicial
--      by the same delta in the same UPDATE on fsj.partida.
--   4. trg_movimiento_stock_validar_correccion_inicial: validates that corrections apply only to
--      partidas of origen EXISTENCIA_INICIAL, while the relevamiento is open, and for a RESTA on
--      a controlled droga requires a DT vigente as autorizado_por_id.
--   5. fsj.partida_validar_update: cantidad_inicial can change only with fsj.mov = 'on' and
--      only for origen EXISTENCIA_INICIAL.
--   6. partida_cantidad_inicial_check: relaxed to allow cantidad_inicial = 0 for EXISTENCIA_INICIAL.
--   7. fsj.movimiento_stock_validar_contralor: exempts CORRECCION_INICIAL_SUMA and CORRECCION_INICIAL_RESTA
--      (like INGRESO_INICIAL).
--   8. New permission stock.relevamiento.editar (category 'operativo'), added to fsj.plantilla_rol_permisos()
--      and backfilled to every existing role holding stock.partida.ingresar.
--
-- Rollback: prisma/rollbacks/0124_planilla_existencia_inicial.down.sql (as a NEW forward migration),
-- docs/rollbacks/planilla-existencia-inicial.md.

-- ============================================================================
-- 1. fsj.relevamiento_fila
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.relevamiento_fila (
  id                  uuid             NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid             NOT NULL,
  droga_id            uuid,
  lote                text,
  fecha_vencimiento   date,
  cantidad            numeric,
  unidad_medida_id    uuid,
  potencia_declarada  numeric,
  costo_unitario      numeric,
  proveedor_id        uuid,
  texto_droga         text,
  creado_por_id       uuid             NOT NULL,
  creado_en           timestamptz(6)   NOT NULL DEFAULT now(),
  actualizado_en      timestamptz(6)   NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT relevamiento_fila_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT relevamiento_fila_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT relevamiento_fila_proveedor_fkey FOREIGN KEY (tenant_id, proveedor_id) REFERENCES fsj.proveedor (tenant_id, id),
  CONSTRAINT relevamiento_fila_creado_por_fkey FOREIGN KEY (tenant_id, creado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT relevamiento_fila_unidad_fkey FOREIGN KEY (unidad_medida_id) REFERENCES fsj.unidad_medida (id),
  CONSTRAINT relevamiento_fila_cantidad_check CHECK (cantidad IS NULL OR cantidad > 0),
  CONSTRAINT relevamiento_fila_costo_check CHECK (costo_unitario IS NULL OR costo_unitario >= 0),
  CONSTRAINT relevamiento_fila_potencia_declarada_check CHECK (potencia_declarada IS NULL OR (potencia_declarada > 0 AND potencia_declarada <= 100))
);

CREATE INDEX IF NOT EXISTS idx_relevamiento_fila_droga ON fsj.relevamiento_fila (tenant_id, droga_id);
CREATE INDEX IF NOT EXISTS idx_relevamiento_fila_proveedor ON fsj.relevamiento_fila (tenant_id, proveedor_id);
CREATE INDEX IF NOT EXISTS idx_relevamiento_fila_unidad ON fsj.relevamiento_fila (tenant_id, unidad_medida_id);

COMMENT ON TABLE fsj.relevamiento_fila IS
  '0124 (openspec/specs/existencia-inicial/spec.md R13). Draft rows of the planilla de existencia inicial. Has no effect on stock until passed.';

SELECT fsj.setup_tenant_table('fsj.relevamiento_fila');

GRANT SELECT, INSERT, UPDATE, DELETE ON fsj.relevamiento_fila TO fsj_app;
REVOKE TRUNCATE ON fsj.relevamiento_fila FROM fsj_app;

CREATE TRIGGER trg_relevamiento_fila_zz_inv_u07_insert
  BEFORE INSERT ON fsj.relevamiento_fila
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('creado_por_id');

CREATE OR REPLACE FUNCTION fsj.relevamiento_fila_validar_abierto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT fsj.relevamiento_inicial_abierto(NEW.tenant_id) THEN
    RAISE EXCEPTION 'INV-S24: cannot save planilla row -- relevamiento inicial of tenant % is closed', NEW.tenant_id
      USING ERRCODE = 'P0001';
  END IF;
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.relevamiento_fila_validar_abierto() IS
  '0124 (INV-S24, R13): rows in the planilla de existencia inicial can only be inserted or updated while the relevamiento is open. DELETE stays allowed.';

DROP TRIGGER IF EXISTS trg_relevamiento_fila_validar_abierto ON fsj.relevamiento_fila;
CREATE TRIGGER trg_relevamiento_fila_validar_abierto
  BEFORE INSERT OR UPDATE ON fsj.relevamiento_fila
  FOR EACH ROW EXECUTE FUNCTION fsj.relevamiento_fila_validar_abierto();

-- ============================================================================
-- 2. Enum values CORRECCION_INICIAL_SUMA and CORRECCION_INICIAL_RESTA
-- ============================================================================
ALTER TYPE fsj.tipo_movimiento ADD VALUE IF NOT EXISTS 'CORRECCION_INICIAL_SUMA';
ALTER TYPE fsj.tipo_movimiento ADD VALUE IF NOT EXISTS 'CORRECCION_INICIAL_RESTA';

-- ============================================================================
-- 3. fsj.movimiento_stock_aplicar
-- ============================================================================
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
  IF NEW.tipo::text IN ('INGRESO_COMPRA', 'INGRESO_INICIAL', 'INGRESO_ELABORACION', 'CORRECCION_INICIAL_SUMA') THEN
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
      cantidad_inicial = CASE
        WHEN NEW.tipo::text IN ('CORRECCION_INICIAL_SUMA', 'CORRECCION_INICIAL_RESTA') THEN cantidad_inicial + v_delta
        ELSE cantidad_inicial
      END,
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
  'INV-S01/S04, INV-S16/S17, INV-S10. 0014: fsj.jornada_actual(tenant_id) instead of current_date. 0074: INV-S10 reads partida.fecha_vencimiento_vigente. 0100: INGRESO_INICIAL adds. 0111: INGRESO_ELABORACION and EGRESO_ELABORACION. 0124: CORRECCION_INICIAL_SUMA adds and RESTA subtracts, and both move cantidad_inicial by delta.';

-- ============================================================================
-- 4. trg_movimiento_stock_validar_correccion_inicial
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_correccion_inicial()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen       fsj.origen_partida;
  v_tipo_control fsj.tipo_control;
BEGIN
  IF NEW.tipo::text NOT IN ('CORRECCION_INICIAL_SUMA', 'CORRECCION_INICIAL_RESTA') THEN
    RETURN NEW;
  END IF;

  SELECT p.origen, d.tipo_control INTO v_origen, v_tipo_control
  FROM fsj.partida p
  JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
  WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.partida_id;

  IF v_origen IS DISTINCT FROM 'EXISTENCIA_INICIAL' THEN
    RAISE EXCEPTION 'correccion inicial is allowed only on partidas with origen EXISTENCIA_INICIAL (partida % is %)',
      NEW.partida_id, v_origen
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT fsj.relevamiento_inicial_abierto(NEW.tenant_id) THEN
    RAISE EXCEPTION 'INV-S24: cannot register % -- relevamiento inicial of tenant % is closed',
      NEW.tipo, NEW.tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.tipo::text = 'CORRECCION_INICIAL_RESTA' AND v_tipo_control IS NOT NULL AND v_tipo_control <> 'NINGUNO' THEN
    IF NEW.autorizado_por_id IS NULL OR NOT fsj.es_dt_vigente(NEW.autorizado_por_id, fsj.jornada_actual(NEW.tenant_id)) THEN
      RAISE EXCEPTION 'INV-U05: CORRECCION_INICIAL_RESTA on controlled droga requires autorizado_por_id by a DT vigente (got %)',
        NEW.autorizado_por_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION fsj.movimiento_stock_validar_correccion_inicial() FROM PUBLIC;

COMMENT ON FUNCTION fsj.movimiento_stock_validar_correccion_inicial() IS
  '0124 (R17, R19): corrección inicial movements require an EXISTENCIA_INICIAL partida and relevamiento abierto; a RESTA on a controlled droga requires a DT vigente as autorizado_por_id.';

DROP TRIGGER IF EXISTS trg_movimiento_stock_validar_correccion_inicial ON fsj.movimiento_stock;
CREATE TRIGGER trg_movimiento_stock_validar_correccion_inicial
  BEFORE INSERT ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.movimiento_stock_validar_correccion_inicial();

-- ============================================================================
-- 5. fsj.partida_validar_update
-- ============================================================================
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

  IF NEW.cantidad_inicial IS DISTINCT FROM OLD.cantidad_inicial THEN
    IF coalesce(current_setting('fsj.mov', true), '') <> 'on' OR OLD.origen <> 'EXISTENCIA_INICIAL' THEN
      RAISE EXCEPTION 'INV-S01: partida.cantidad_inicial can only be changed by a movimiento_stock on an EXISTENCIA_INICIAL partida'
        USING ERRCODE = 'P0001';
    END IF;
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
  'INV-S01/S04, INV-S16/S17 (0008), INV-S23 (0074) and 0124: cantidad_disponible / fecha_apertura only through fsj.movimiento_stock_aplicar(), cantidad_inicial only for EXISTENCIA_INICIAL via movimiento_stock, fecha_vencimiento never, fecha_vencimiento_vigente only through fsj.reanalisis_partida_aplicar().';

-- ============================================================================
-- 6. partida_cantidad_inicial_check
-- ============================================================================
ALTER TABLE fsj.partida
  DROP CONSTRAINT IF EXISTS partida_cantidad_inicial_check;

ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_cantidad_inicial_check
  CHECK (cantidad_inicial > 0 OR (origen = 'EXISTENCIA_INICIAL' AND cantidad_inicial >= 0));

-- ============================================================================
-- 7. fsj.movimiento_stock_validar_contralor
-- ============================================================================
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

  IF v_mov.tipo::text IN ('INGRESO_INICIAL', 'CORRECCION_INICIAL_SUMA', 'CORRECCION_INICIAL_RESTA') THEN
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
  'INV-L08 (0014). 0100/0124: INGRESO_INICIAL and corrección inicial are exempt -- physical stock accounted for in APERTURA (docs/specs/existencia-inicial.md R8).';

-- ============================================================================
-- 8. Permiso stock.relevamiento.editar
-- ============================================================================
INSERT INTO fsj.permiso (codigo, categoria, descripcion)
VALUES ('stock.relevamiento.editar', 'operativo', 'Editar y guardar filas en la planilla de existencia inicial.')
ON CONFLICT (codigo) DO NOTHING;

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
      'stock.partida.potencia.corregir', 'stock.relevamiento.editar',
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
      'stock.ajuste.registrar', 'stock.partida.ingresar', 'stock.relevamiento.editar', 'stock.valorizado.ver', 'stock.ver'
    ])
  ) AS m(rol_codigo, permisos)
  CROSS JOIN LATERAL unnest(m.permisos) AS c(permiso_codigo);
$$;

INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id)
SELECT rp.tenant_id, rp.rol_id, p_nuevo.id
FROM fsj.rol_permiso rp
JOIN fsj.permiso p_existente ON p_existente.id = rp.permiso_id AND p_existente.codigo = 'stock.partida.ingresar'
CROSS JOIN fsj.permiso p_nuevo
WHERE p_nuevo.codigo = 'stock.relevamiento.editar'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;
