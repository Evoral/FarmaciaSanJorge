-- 0012_fichas_tecnicas_lineas_pesaje
--
-- FASE 1, point 1.10: fsj.ficha_tecnica + fsj.linea_pesaje (M10), plus the
-- per-tenant weighing parameters (precision_balanza, exceso_pesada_porcentaje)
-- in fsj.parametro. Depends on 0001 (fsj.parametro, fsj.setup_tenant_table),
-- 0006 (fsj.unidad_medida), 0007 (fsj.droga), 0011 (fsj.item_receta).
--
-- Source of truth: docs/specs/ficha-tecnica.md. cotizacion / regla_precio
-- are OUT OF SCOPE (DP-09 unresolved, task binding decision) -- not created
-- here, unlike the plan's M10 which bundles them in.
--
-- The 1—1 in the original diagram is WRONG (INV-R05 requires versions) --
-- ficha_tecnica is versioned: UNIQUE (tenant_id, item_receta_id, version).
-- ficha_tecnica and linea_pesaje are immutable after insert (no
-- UPDATE/DELETE) -- see plan §10 model summary table.

-- ============================================================================
-- ficha_tecnica (M10) -- tenant-scoped, fully immutable after insert
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.ficha_tecnica (
  id                 uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  item_receta_id     uuid NOT NULL,
  version            integer NOT NULL,
  generada_en        timestamptz NOT NULL DEFAULT now(),
  generada_por_id    uuid NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ficha_tecnica_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT ficha_tecnica_item_receta_fkey FOREIGN KEY (tenant_id, item_receta_id) REFERENCES fsj.item_receta (tenant_id, id),
  CONSTRAINT ficha_tecnica_generada_por_fkey FOREIGN KEY (tenant_id, generada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT ficha_tecnica_version_check CHECK (version > 0),
  -- INV-R05 (corrected 1..* -- see migration header).
  CONSTRAINT ficha_tecnica_version_unica UNIQUE (tenant_id, item_receta_id, version)
);

COMMENT ON TABLE fsj.ficha_tecnica IS
  'M10 / docs/specs/ficha-tecnica.md. Versioned (INV-R05): UNIQUE (tenant_id, item_receta_id, version) -- the diagram''s 1-1 is wrong. Fully immutable after insert (no UPDATE/DELETE grant, trigger below). INV-R03 (>=1 linea_pesaje) is enforced below.';

SELECT fsj.setup_tenant_table('fsj.ficha_tecnica');

-- Immutable: no UPDATE/DELETE grant at all (ALTER DEFAULT PRIVILEGES only
-- ever grants SELECT/INSERT, so this REVOKE is explicit intent/defense in
-- depth, same convention as fsj.movimiento_stock in migration 0008).
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.ficha_tecnica FROM fsj_app;

CREATE TRIGGER trg_ficha_tecnica_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.ficha_tecnica
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- linea_pesaje (M10) -- tenant-scoped, fully immutable after insert
--
-- Columns per docs/specs/ficha-tecnica.md's "LineaPesaje" output model, plus
-- the revised INV-R04 from the task's binding decisions: non-manual lines
-- require BOTH cantidad_teorica and cantidad_a_pesar (> 0); manual lines
-- require BOTH to be NULL. droga_nombre is a frozen snapshot (INV-F05: a
-- later change to Droga.nombre must not alter an already-generated line).
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.linea_pesaje (
  id                  uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  ficha_tecnica_id    uuid NOT NULL,
  droga_id            uuid NOT NULL,
  droga_nombre        text NOT NULL, -- frozen snapshot (INV-F05)
  cantidad_teorica    numeric,       -- NULL when es_enrase_manual
  exceso_aplicado     numeric NOT NULL DEFAULT 0,
  cantidad_a_pesar    numeric,       -- NULL when es_enrase_manual
  unidad_medida_id    uuid NOT NULL, -- base unit of the magnitude (spec)
  es_enrase_manual    boolean NOT NULL DEFAULT false,
  orden               integer NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT linea_pesaje_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT linea_pesaje_ficha_fkey FOREIGN KEY (tenant_id, ficha_tecnica_id) REFERENCES fsj.ficha_tecnica (tenant_id, id),
  CONSTRAINT linea_pesaje_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  -- Global catalog (DP-39), same convention as componente_item_receta.unidad_medida_id.
  CONSTRAINT linea_pesaje_unidad_fkey FOREIGN KEY (unidad_medida_id) REFERENCES fsj.unidad_medida (id),
  CONSTRAINT linea_pesaje_orden_unico UNIQUE (tenant_id, ficha_tecnica_id, orden),
  CONSTRAINT linea_pesaje_exceso_check CHECK (exceso_aplicado >= 0),
  -- Revised INV-R04 (task binding decision): non-manual <=> both quantities
  -- present and cantidad_a_pesar > 0; manual <=> both NULL.
  CONSTRAINT linea_pesaje_manual_check CHECK (
    (es_enrase_manual = false AND cantidad_teorica IS NOT NULL AND cantidad_a_pesar IS NOT NULL AND cantidad_a_pesar > 0)
    OR
    (es_enrase_manual = true AND cantidad_teorica IS NULL AND cantidad_a_pesar IS NULL)
  )
);

COMMENT ON TABLE fsj.linea_pesaje IS
  'M10 / docs/specs/ficha-tecnica.md "LineaPesaje". Frozen at generation (droga_nombre snapshot, INV-F05); fully immutable after insert (no UPDATE/DELETE grant, trigger below). Revised INV-R04 enforced by linea_pesaje_manual_check.';

SELECT fsj.setup_tenant_table('fsj.linea_pesaje');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.linea_pesaje FROM fsj_app;

CREATE TRIGGER trg_linea_pesaje_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.linea_pesaje
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- INV-R03: a ficha_tecnica has at least one linea_pesaje, checked at COMMIT
-- (DEFERRABLE). linea_pesaje has no UPDATE/DELETE grant at all (immutable
-- above), so only the INSERT-side check is needed in practice, but the
-- two-sided pattern is kept for consistency with V1/INV-R01 (migration
-- 0011) and to also cover fsj_owner mistakenly deleting a line.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.ficha_tecnica_validar_al_menos_una_linea(p_tenant_id uuid, p_ficha_tecnica_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fsj.linea_pesaje
    WHERE tenant_id = p_tenant_id AND ficha_tecnica_id = p_ficha_tecnica_id
  ) THEN
    RAISE EXCEPTION 'INV-R03: ficha_tecnica % must have at least one linea_pesaje', p_ficha_tecnica_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_linea_pesaje_check_ficha_tiene_linea()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fsj.ficha_tecnica_validar_al_menos_una_linea(OLD.tenant_id, OLD.ficha_tecnica_id);
    RETURN OLD;
  ELSE
    PERFORM fsj.ficha_tecnica_validar_al_menos_una_linea(NEW.tenant_id, NEW.ficha_tecnica_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_linea_pesaje_ficha_tiene_linea
  AFTER INSERT OR UPDATE OR DELETE ON fsj.linea_pesaje
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_linea_pesaje_check_ficha_tiene_linea();

CREATE OR REPLACE FUNCTION fsj.trg_ficha_tecnica_check_tiene_linea()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.ficha_tecnica_validar_al_menos_una_linea(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ficha_tecnica_tiene_linea
  AFTER INSERT ON fsj.ficha_tecnica
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_ficha_tecnica_check_tiene_linea();

-- ============================================================================
-- Per-tenant weighing parameters (docs/specs/ficha-tecnica.md
-- "ParametrosPesaje"): precision_balanza (default 0.001, in GRAMO) and
-- exceso_pesada_porcentaje (default 0). Stored as ordinary fsj.parametro
-- rows (M00, migration 0001) -- no new table needed.
--
-- Backfilled here for tenants that already exist (this migration runs once
-- against the single real database -- see migration 0000 header). New
-- tenants get these two rows from scripts/create-tenant.ts (extended
-- alongside this migration) so both paths stay in sync.
-- ============================================================================
INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT t.id, 'precision_balanza', 'NUMERO', '0.001',
       'Precision de la balanza para redondeo de linea_pesaje (GRAMO) -- docs/specs/ficha-tecnica.md R8'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT t.id, 'exceso_pesada_porcentaje', 'NUMERO', '0',
       'Porcentaje de exceso de pesada aplicado a lineas no manuales -- docs/specs/ficha-tecnica.md R7'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;
