-- 0111 -- Lotes elaborados en la farmacia: diluciones and products made from materias primas
-- (change openspec/changes/lotes-elaborados/, spec openspec/specs/elaboracion-lote/spec.md once archived).
--
-- An elaborated lot is a PARTIDA (design §1): "Elaborar lote" consumes partidas of its components and creates one
-- partida with origen ELABORACION_PROPIA, no proveedor. A dilución is a partida of the SAME droga with its computed
-- potencia_declarada, so the purity engine (0058, R25, INV-S12) uses it unchanged.
--
--   1. fsj.origen_partida gains ELABORACION_PROPIA; fsj.tipo_movimiento gains INGRESO_ELABORACION (adds saldo) and
--      EGRESO_ELABORACION (subtracts). As in 0100, the new values are only referenced as text inside plpgsql bodies or
--      through `::text` in constraints, never as enum literals, so adding them in this same transaction is safe.
--   2. fsj.partida: proveedor NULL also for ELABORACION_PROPIA (partida_proveedor_obligatorio), and an elaborated
--      partida never has a proveedor nor a comprobante de compra. Lote uniqueness: uq_partida_lote_sin_proveedor (0100)
--      already covers every NULL-proveedor row.
--   3. fsj.tipo_elaboracion + fsj.elaboracion_lote: one row per elaboration (the produced partida, DILUCION or FORMULA,
--      who elaborated it). Immutable. Every movement of the elaboration points at it (movimiento_stock.
--      elaboracion_lote_id, required iff the tipo is INGRESO_/EGRESO_ELABORACION).
--   4. INV-EL1..EL4 (fsj.elaboracion_lote_validar, deferred, from both tables): exactly one INGRESO_ELABORACION, on the
--      produced partida, equal to its cantidad_inicial; at least one EGRESO_ELABORACION, none from the produced
--      partida; a DILUCION consumes its own droga and holds exactly the active consumed (tolerance 10^-4, INV-S12's); a
--      FORMULA lot never consumes its own droga; the produced vencimiento is never later than a consumed one.
--   5. fsj.movimiento_stock_aplicar (latest 0100): INGRESO_ELABORACION adds; EGRESO_ELABORACION subtracts, is refused
--      on an expired partida (INV-S10) and opens the partida (INV-S16/S17), like EGRESO_PREPARACION.
--   6. fsj.partida_validar_ingreso_compra (INV-STK-002 / INV-S25, latest 0100): ELABORACION_PROPIA requires exactly one
--      INGRESO_ELABORACION.
--   7. fsj.formula_elaboracion + fsj.formula_elaboracion_componente: a droga's fórmula (one per droga), quantities in
--      each droga's unidad base. One level only (INV-EL5): a component is never the fórmula's own droga nor a droga
--      with its own fórmula.
--   8. fsj.v_stock_droga (latest 0074) gains stock_activo (Σ disponible x potencia / 100).
--   9. Permiso stock.lote.elaborar (operativo). No role rows: like every operativo permiso, ADMINISTRADOR does NOT get it
--      (migration 0054); each role gets it through the role editor. PIN-configurable, not in the default PIN set.
--
-- Controlled drogas are NOT limited (user decision 2026-10-29): INV-L08 (movimiento_stock_validar_contralor) is
-- unchanged and only fires once the tenant activates the contralor.
--
-- Additive for old code: nothing writes the new values, tables or column. New code without 0111: elaborating fails.
-- *** APPLY 0111 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Numbering: 0110 (20261029120000_0110_insumos_preparacion) is the highest at the time of writing -- re-check
-- before applying.
-- Rollback: prisma/rollbacks/0111_lotes_elaborados.down.sql (as a NEW forward migration),
-- docs/rollbacks/lotes-elaborados.md.

-- ============================================================================
-- 1. Enum values
-- ============================================================================
ALTER TYPE fsj.origen_partida ADD VALUE IF NOT EXISTS 'ELABORACION_PROPIA';
ALTER TYPE fsj.tipo_movimiento ADD VALUE IF NOT EXISTS 'INGRESO_ELABORACION';
ALTER TYPE fsj.tipo_movimiento ADD VALUE IF NOT EXISTS 'EGRESO_ELABORACION';

-- ============================================================================
-- 2. fsj.partida
-- ============================================================================
ALTER TABLE fsj.partida DROP CONSTRAINT IF EXISTS partida_proveedor_obligatorio;
ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_proveedor_obligatorio
    CHECK (proveedor_id IS NOT NULL OR origen::text IN ('EXISTENCIA_INICIAL', 'ELABORACION_PROPIA')),
  ADD CONSTRAINT partida_elaborada_sin_compra
    CHECK (origen::text <> 'ELABORACION_PROPIA' OR (proveedor_id IS NULL AND comprobante_compra_id IS NULL));

COMMENT ON COLUMN fsj.partida.origen IS
  '0100: COMPRA (a purchase, INGRESO_COMPRA) or EXISTENCIA_INICIAL (stock counted at the relevamiento inicial, INGRESO_INICIAL, proveedor optional). 0111: ELABORACION_PROPIA (made in the farmacia, INGRESO_ELABORACION, no proveedor; fsj.elaboracion_lote). Insert-only.';

-- ============================================================================
-- 3. fsj.elaboracion_lote
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE fsj.tipo_elaboracion AS ENUM ('DILUCION', 'FORMULA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7 first: elaboracion_lote references the fórmula it was made from.
CREATE TABLE IF NOT EXISTS fsj.formula_elaboracion (
  id                  uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  droga_id            uuid        NOT NULL,
  cantidad_referencia numeric     NOT NULL,   -- the produced droga's unidad base
  actualizada_por_id  uuid        NOT NULL,
  actualizada_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT formula_elaboracion_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT formula_elaboracion_droga_key UNIQUE (tenant_id, droga_id),
  CONSTRAINT formula_elaboracion_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT formula_elaboracion_actualizada_por_fkey FOREIGN KEY (tenant_id, actualizada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT formula_elaboracion_cantidad_referencia_check CHECK (cantidad_referencia > 0)
);

COMMENT ON TABLE fsj.formula_elaboracion IS
  '0111. A droga''s fórmula (one per droga): its components per cantidad_referencia of the product, all in each droga''s unidad base. Precarga of "Elaborar lote" and, without a costo de proveedor, the droga''s cost (costos-proveedor R38). Components are replaced as a whole on every save.';

CREATE TABLE IF NOT EXISTS fsj.formula_elaboracion_componente (
  id          uuid     NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id   uuid     NOT NULL,
  formula_id  uuid     NOT NULL,
  orden       smallint NOT NULL,
  droga_id    uuid     NOT NULL,
  cantidad    numeric  NOT NULL,   -- the component droga's unidad base
  PRIMARY KEY (id),
  CONSTRAINT formula_elaboracion_componente_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT formula_elaboracion_componente_droga_key UNIQUE (tenant_id, formula_id, droga_id),
  CONSTRAINT formula_elaboracion_componente_orden_key UNIQUE (tenant_id, formula_id, orden),
  CONSTRAINT formula_elaboracion_componente_formula_fkey FOREIGN KEY (tenant_id, formula_id) REFERENCES fsj.formula_elaboracion (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT formula_elaboracion_componente_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT formula_elaboracion_componente_cantidad_check CHECK (cantidad > 0)
);

COMMENT ON TABLE fsj.formula_elaboracion_componente IS
  '0111. A component of a fórmula (INV-EL5: never the fórmula''s own droga, never a droga with its own fórmula -- one level).';

SELECT fsj.setup_tenant_table('fsj.formula_elaboracion');
SELECT fsj.setup_tenant_table('fsj.formula_elaboracion_componente');

-- The header is upserted; the components are replaced (DELETE + INSERT), never updated.
GRANT SELECT, INSERT, DELETE ON fsj.formula_elaboracion TO fsj_app;
REVOKE UPDATE ON fsj.formula_elaboracion FROM fsj_app;
GRANT UPDATE (cantidad_referencia, actualizada_por_id, actualizada_en) ON fsj.formula_elaboracion TO fsj_app;
GRANT SELECT, INSERT, DELETE ON fsj.formula_elaboracion_componente TO fsj_app;
REVOKE UPDATE ON fsj.formula_elaboracion_componente FROM fsj_app;

-- INV-EL5: one level. Checked from both sides (a component insert, and a fórmula for a droga already used as one).
CREATE OR REPLACE FUNCTION fsj.formula_elaboracion_validar_nivel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'formula_elaboracion_componente' THEN
    IF EXISTS (SELECT 1 FROM fsj.formula_elaboracion f
               WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.formula_id AND f.droga_id = NEW.droga_id) THEN
      RAISE EXCEPTION 'INV-EL5: a fórmula cannot list its own droga % as a component', NEW.droga_id
        USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM fsj.formula_elaboracion f
               WHERE f.tenant_id = NEW.tenant_id AND f.droga_id = NEW.droga_id) THEN
      RAISE EXCEPTION 'INV-EL5: droga % has its own fórmula and cannot be a component (one level only)', NEW.droga_id
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM fsj.formula_elaboracion_componente c
               WHERE c.tenant_id = NEW.tenant_id AND c.droga_id = NEW.droga_id) THEN
      RAISE EXCEPTION 'INV-EL5: droga % is a component of another fórmula and cannot have its own (one level only)', NEW.droga_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION fsj.formula_elaboracion_validar_nivel() IS
  'INV-EL5 (0111): fórmulas have one level -- a component is never the fórmula''s own droga nor a droga with its own fórmula.';

DROP TRIGGER IF EXISTS trg_formula_elaboracion_validar_nivel ON fsj.formula_elaboracion;
CREATE TRIGGER trg_formula_elaboracion_validar_nivel
  BEFORE INSERT ON fsj.formula_elaboracion
  FOR EACH ROW EXECUTE FUNCTION fsj.formula_elaboracion_validar_nivel();

DROP TRIGGER IF EXISTS trg_formula_elaboracion_componente_validar_nivel ON fsj.formula_elaboracion_componente;
CREATE TRIGGER trg_formula_elaboracion_componente_validar_nivel
  BEFORE INSERT ON fsj.formula_elaboracion_componente
  FOR EACH ROW EXECUTE FUNCTION fsj.formula_elaboracion_validar_nivel();

CREATE TRIGGER trg_formula_elaboracion_zz_inv_u07_insert
  BEFORE INSERT ON fsj.formula_elaboracion
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('actualizada_por_id');

CREATE TABLE IF NOT EXISTS fsj.elaboracion_lote (
  id                uuid                  NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid                  NOT NULL,
  partida_id        uuid                  NOT NULL,   -- the produced partida (origen ELABORACION_PROPIA)
  tipo              fsj.tipo_elaboracion  NOT NULL,
  formula_id        uuid,                             -- the fórmula it was precargado from; NULL for a DILUCION
  elaborado_por_id  uuid                  NOT NULL,
  registrado_en     timestamptz           NOT NULL DEFAULT now(),
  observacion       text,
  PRIMARY KEY (id),
  CONSTRAINT elaboracion_lote_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT elaboracion_lote_partida_key UNIQUE (tenant_id, partida_id),
  CONSTRAINT elaboracion_lote_partida_fkey FOREIGN KEY (tenant_id, partida_id) REFERENCES fsj.partida (tenant_id, id),
  CONSTRAINT elaboracion_lote_formula_fkey FOREIGN KEY (tenant_id, formula_id) REFERENCES fsj.formula_elaboracion (tenant_id, id),
  CONSTRAINT elaboracion_lote_elaborado_por_fkey FOREIGN KEY (tenant_id, elaborado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT elaboracion_lote_formula_check CHECK (tipo <> 'DILUCION' OR formula_id IS NULL)
);

COMMENT ON TABLE fsj.elaboracion_lote IS
  '0111. One elaboration: the produced partida (its cantidad_inicial is the cantidad producida), DILUCION (same droga, computed potencia) or FORMULA (another droga), who elaborated it. Its movements point at it (movimiento_stock.elaboracion_lote_id). Immutable. Never in the libro recetario (user decision 2026-10-29).';

SELECT fsj.setup_tenant_table('fsj.elaboracion_lote');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.elaboracion_lote FROM fsj_app;

CREATE TRIGGER trg_elaboracion_lote_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.elaboracion_lote
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

CREATE TRIGGER trg_elaboracion_lote_zz_inv_u07_insert
  BEFORE INSERT ON fsj.elaboracion_lote
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('elaborado_por_id');

ALTER TABLE fsj.movimiento_stock
  ADD COLUMN IF NOT EXISTS elaboracion_lote_id uuid;

ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_elaboracion_lote_fkey
    FOREIGN KEY (tenant_id, elaboracion_lote_id) REFERENCES fsj.elaboracion_lote (tenant_id, id),
  ADD CONSTRAINT movimiento_stock_elaboracion_lote_check
    CHECK ((tipo::text IN ('INGRESO_ELABORACION', 'EGRESO_ELABORACION')) = (elaboracion_lote_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_movimiento_stock_elaboracion_lote
  ON fsj.movimiento_stock (tenant_id, elaboracion_lote_id)
  WHERE elaboracion_lote_id IS NOT NULL;

COMMENT ON COLUMN fsj.movimiento_stock.elaboracion_lote_id IS
  '0111. The elaboration an INGRESO_ELABORACION / EGRESO_ELABORACION belongs to; required for those tipos, NULL for every other.';

-- ============================================================================
-- 4. INV-EL1..EL4: the elaboration as a whole, at commit time.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.elaboracion_lote_validar(p_tenant_id uuid, p_elaboracion_lote_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_lote               fsj.elaboracion_lote%ROWTYPE;
  v_partida            fsj.partida%ROWTYPE;
  v_ingresos           integer;
  v_ingresos_partida   integer;
  v_ingreso_total      numeric;
  v_egresos            integer;
  v_egresos_propios    integer;
  v_egresos_droga      integer;
  v_activo_consumido   numeric;
  v_activo_producido   numeric;
  v_vencimiento_minimo date;
  v_alguno_vence       boolean;
  v_tolerancia         constant numeric := 0.0001;
BEGIN
  SELECT * INTO v_lote FROM fsj.elaboracion_lote WHERE tenant_id = p_tenant_id AND id = p_elaboracion_lote_id;
  SELECT * INTO v_partida FROM fsj.partida WHERE tenant_id = p_tenant_id AND id = v_lote.partida_id;

  IF v_partida.origen::text <> 'ELABORACION_PROPIA' THEN
    RAISE EXCEPTION 'INV-EL1: elaboracion_lote % produces partida % of origen % (expected ELABORACION_PROPIA)', v_lote.id, v_partida.id, v_partida.origen
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL1: one ingreso, on the produced partida, equal to its cantidad_inicial.
  SELECT count(*), count(*) FILTER (WHERE m.partida_id = v_partida.id), coalesce(sum(m.cantidad), 0)
    INTO v_ingresos, v_ingresos_partida, v_ingreso_total
  FROM fsj.movimiento_stock m
  WHERE m.tenant_id = p_tenant_id AND m.elaboracion_lote_id = v_lote.id AND m.tipo::text = 'INGRESO_ELABORACION';

  IF v_ingresos <> 1 OR v_ingresos_partida <> 1 OR v_ingreso_total <> v_partida.cantidad_inicial THEN
    RAISE EXCEPTION 'INV-EL1: elaboracion_lote % must have exactly one INGRESO_ELABORACION on its partida % equal to cantidad_inicial % (found % ingresos, % on the partida, totalling %)',
      v_lote.id, v_partida.id, v_partida.cantidad_inicial, v_ingresos, v_ingresos_partida, v_ingreso_total
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL2: at least one egreso, none from the produced partida.
  SELECT count(*),
         count(*) FILTER (WHERE m.partida_id = v_partida.id),
         count(*) FILTER (WHERE p.droga_id = v_partida.droga_id),
         coalesce(sum(m.cantidad * coalesce(p.potencia_declarada, 100) / 100) FILTER (WHERE p.droga_id = v_partida.droga_id), 0),
         min(p.fecha_vencimiento_vigente),
         bool_or(p.fecha_vencimiento_vigente IS NOT NULL)
    INTO v_egresos, v_egresos_propios, v_egresos_droga, v_activo_consumido, v_vencimiento_minimo, v_alguno_vence
  FROM fsj.movimiento_stock m
  JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
  WHERE m.tenant_id = p_tenant_id AND m.elaboracion_lote_id = v_lote.id AND m.tipo::text = 'EGRESO_ELABORACION';

  IF v_egresos = 0 OR v_egresos_propios <> 0 THEN
    RAISE EXCEPTION 'INV-EL2: elaboracion_lote % must consume at least one partida and never its own produced partida (found % egresos, % from the produced partida)',
      v_lote.id, v_egresos, v_egresos_propios
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL3: a DILUCION consumes its own droga and holds exactly the active consumed; a FORMULA lot never consumes
  -- its own droga.
  IF v_lote.tipo = 'DILUCION' THEN
    v_activo_producido := v_partida.cantidad_inicial * coalesce(v_partida.potencia_declarada, 100) / 100;
    IF v_egresos_droga = 0 OR abs(v_activo_producido - v_activo_consumido) >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-EL3: dilución % must hold the active it consumed of droga % (consumed %, produced %)',
        v_lote.id, v_partida.droga_id, v_activo_consumido, v_activo_producido
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_egresos_droga <> 0 THEN
    RAISE EXCEPTION 'INV-EL3: elaboracion_lote % (FORMULA) consumes its own droga %', v_lote.id, v_partida.droga_id
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL4: never later than a consumed partida's vencimiento vigente (consumed ones without one do not bound it).
  IF v_alguno_vence AND (v_partida.fecha_vencimiento IS NULL OR v_partida.fecha_vencimiento > v_vencimiento_minimo) THEN
    RAISE EXCEPTION 'INV-EL4: partida % expires % but a consumed partida expires % (it can expire earlier, never later)',
      v_partida.id, coalesce(v_partida.fecha_vencimiento::text, 'never'), v_vencimiento_minimo
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
COMMENT ON FUNCTION fsj.elaboracion_lote_validar(uuid, uuid) IS
  'INV-EL1..EL4 (0111): by commit time an elaboration has one INGRESO_ELABORACION on its ELABORACION_PROPIA partida equal to cantidad_inicial, at least one EGRESO_ELABORACION and none from that partida; a DILUCION holds the active it consumed of its droga (tolerance 10^-4), a FORMULA lot never consumes its own droga; the produced vencimiento is never later than a consumed one.';

CREATE OR REPLACE FUNCTION fsj.trg_elaboracion_lote_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'elaboracion_lote' THEN
    PERFORM fsj.elaboracion_lote_validar(NEW.tenant_id, NEW.id);
  ELSE
    PERFORM fsj.elaboracion_lote_validar(NEW.tenant_id, NEW.elaboracion_lote_id);
  END IF;
  RETURN NULL;
END;
$$;

-- From the lote (its own transaction) and from any later movement pointing at an existing lote.
CREATE CONSTRAINT TRIGGER trg_elaboracion_lote_validar
  AFTER INSERT ON fsj.elaboracion_lote
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_elaboracion_lote_check();

CREATE CONSTRAINT TRIGGER trg_movimiento_stock_elaboracion_lote_validar
  AFTER INSERT ON fsj.movimiento_stock
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.elaboracion_lote_id IS NOT NULL)
  EXECUTE FUNCTION fsj.trg_elaboracion_lote_check();

-- ============================================================================
-- 5. movimiento_stock_aplicar: the elaboration tipos. Body otherwise identical to 0100.
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

-- ============================================================================
-- 6. INV-STK-002 / INV-S25: exactly one ingreso, of the partida's own type.
-- Same signature as 0008 (trg_partida_check_ingreso_compra keeps calling it).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.partida_validar_ingreso_compra(p_tenant_id uuid, p_partida_id uuid, p_cantidad_inicial numeric)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen     fsj.origen_partida;
  v_tipo       text;
  v_count      integer;
  v_total      numeric;
  v_otros      integer;
BEGIN
  SELECT origen INTO v_origen FROM fsj.partida WHERE tenant_id = p_tenant_id AND id = p_partida_id;
  v_tipo := CASE v_origen::text
    WHEN 'EXISTENCIA_INICIAL' THEN 'INGRESO_INICIAL'
    WHEN 'ELABORACION_PROPIA' THEN 'INGRESO_ELABORACION'
    ELSE 'INGRESO_COMPRA'
  END;

  SELECT count(*) FILTER (WHERE tipo::text = v_tipo),
         coalesce(sum(cantidad) FILTER (WHERE tipo::text = v_tipo), 0),
         count(*) FILTER (WHERE tipo::text IN ('INGRESO_COMPRA', 'INGRESO_INICIAL', 'INGRESO_ELABORACION') AND tipo::text <> v_tipo)
    INTO v_count, v_total, v_otros
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND partida_id = p_partida_id;

  IF v_count <> 1 OR v_total <> p_cantidad_inicial OR v_otros <> 0 THEN
    RAISE EXCEPTION 'INV-STK-002/INV-S25: partida % (origen %) must have exactly one % movement equal to cantidad_inicial and no other ingreso (found % totalling %, % of the other types, expected %)',
      p_partida_id, v_origen, v_tipo, v_count, v_total, v_otros, p_cantidad_inicial
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
COMMENT ON FUNCTION fsj.partida_validar_ingreso_compra(uuid, uuid, numeric) IS
  'INV-STK-002 (0008), INV-S25 (0100, 0111): by commit time a partida has exactly one ingreso equal to cantidad_inicial, of its origen''s type (COMPRA -> INGRESO_COMPRA, EXISTENCIA_INICIAL -> INGRESO_INICIAL, ELABORACION_PROPIA -> INGRESO_ELABORACION), and none of the others.';

-- ============================================================================
-- 8. v_stock_droga: stock_activo. Body otherwise identical to 0074 (new column appended last).
-- ============================================================================
CREATE OR REPLACE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(
    sum(greatest(p.cantidad_disponible - r.reservado, 0))
      FILTER (WHERE p.fecha_vencimiento_vigente IS NULL OR p.fecha_vencimiento_vigente >= fsj.jornada_actual(d.tenant_id)),
    0
  ) AS stock_disponible,
  coalesce(
    sum(greatest(p.cantidad_disponible - r.reservado, 0) * coalesce(p.potencia_declarada, 100) / 100)
      FILTER (WHERE p.fecha_vencimiento_vigente IS NULL OR p.fecha_vencimiento_vigente >= fsj.jornada_actual(d.tenant_id)),
    0
  ) AS stock_activo
FROM fsj.droga d
LEFT JOIN fsj.partida p ON p.tenant_id = d.tenant_id AND p.droga_id = d.id
LEFT JOIN LATERAL (
  SELECT coalesce(sum(rs.cantidad), 0) AS reservado
  FROM fsj.reserva_stock rs
  JOIN fsj.preparacion rp ON rp.tenant_id = rs.tenant_id AND rp.id = rs.preparacion_id
  WHERE rs.tenant_id = p.tenant_id AND rs.partida_id = p.id AND rp.estado = 'INICIADA'
) r ON true
GROUP BY d.tenant_id, d.id;

COMMENT ON VIEW fsj.v_stock_droga IS
  'M06/M07. stock_disponible = SUM over non-expired partidas (fecha_vencimiento_vigente -- the latest reanálisis, else fecha_vencimiento, 0074 -- NULL, does not expire, 0064, or >= fsj.jornada_actual(tenant_id), 0025) of cantidad_disponible minus the stock reserved by INICIADA preparaciones (fsj.reserva_stock, 0071), never below 0 per partida: the PHYSICAL stock. stock_activo (0111) = the same sum weighted by each partida''s potencia_declarada / 100 (NULL = 100): the active ingredient. Do not sum in the application when this view exists (plan §9 M07 "NO HACER").';

-- ============================================================================
-- 9. Permiso
-- ============================================================================
INSERT INTO fsj.permiso (codigo, categoria, descripcion) VALUES
  ('stock.lote.elaborar', 'operativo', 'Elaborar lotes y diluciones en la farmacia')
ON CONFLICT (codigo) DO NOTHING;
