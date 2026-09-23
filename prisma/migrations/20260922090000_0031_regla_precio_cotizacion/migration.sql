-- 0031_regla_precio_cotizacion
--
-- FASE 4 point 4.6 (M08, reglas de precio) + FASE 7 point 7.4 (M10,
-- cotizacion), unblocked by DP-09 (task binding decision, 2026-09-22):
--   "Price = cost of the drugs x margin percentage. NO fixed fee, no
--   variation by forma farmaceutica."
--
-- [DEVIATION from the plan's M08 sketch, documented]: plan section 9 M08
-- proposes `regla_precio(nombre, forma_farmaceutica, margen, honorario_fijo,
-- vigente_desde, vigente_hasta, creado_por_id)`. DP-09's resolution drops
-- `honorario_fijo` (no fixed fee) and `forma_farmaceutica` (no variation by
-- form) entirely -- this migration implements the RESOLVED formula, not the
-- plan's pre-DP-09 superset. `nombre` is also dropped: with a single global
-- multiplier and no per-rule variation, a rule has nothing to name.
--
-- regla_precio (M08): versioned and immutable (INV-PR-001) -- editing the
-- margin NEVER updates a row; the application closes the currently open row
-- (sets vigente_hasta) and INSERTs a new one, in the SAME transaction (see
-- modules/precios/application/guardar-regla-precio.ts). At most one OPEN
-- rule (vigente_hasta IS NULL) per tenant, enforced by a partial unique
-- index (task instruction: "a partial unique index or an EXCLUDE" -- no
-- period-overlap is possible here since only ONE row is ever open at a
-- time, so EXCLUDE's extra power over a plain unique index is not needed).
--
-- cotizacion (M10 FASE 7.4): fully insert-only history (INV-R06: "the
-- current cotizacion of an item is the one with the most recent
-- calculada_en" is an [APP] read-time rule over this history -- exactly
-- like the plan's own classification of INV-R06 as [APP], migration 0012's
-- header for the analogous INV-R05/ficha_tecnica precedent). No
-- UPDATE/DELETE grant at all, so previous cotizaciones can never be deleted
-- or modified (task instruction, INV-R06).
--
-- INV-R02 ("sin efectos"): fsj.cotizacion has ZERO relationship to
-- fsj.movimiento_stock / fsj.asiento_recetario / fsj.contador_correlativo --
-- no FK, no trigger, no shared sequence touches any of them from this
-- table. Calculating a cotizacion is provably incapable of moving stock,
-- asentando, consuming a correlativo, or reserving anything, by
-- construction (see tests/db/regla-precio-cotizacion.test.ts for the same
-- "snapshot before/after" proof style as
-- tests/db/fichas-tecnicas-generacion.test.ts's INV-R02 test).
--
-- Depends on 0001 (fsj.setup_tenant_table, fsj.forbid_delete,
-- fsj.forbid_update_delete), 0002 (fsj.usuario -- the precios.reglas.editar
-- / cotizaciones.calcular / cotizaciones.ver permisos were ALREADY seeded
-- there, unused until this migration), 0011 (fsj.item_receta).

-- ============================================================================
-- regla_precio (M08) -- tenant-scoped, versioned, immutable except the
-- vigente_hasta close.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.regla_precio (
  id             uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  margen         numeric NOT NULL,
  vigente_desde  timestamptz NOT NULL DEFAULT now(),
  vigente_hasta  timestamptz,
  creado_por_id  uuid NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT regla_precio_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT regla_precio_creado_por_fkey FOREIGN KEY (tenant_id, creado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT regla_precio_margen_check CHECK (margen >= 0),
  CONSTRAINT regla_precio_vigencia_check CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

COMMENT ON TABLE fsj.regla_precio IS
  'M08 (DP-09 RESUELTA). precio_final = costo_insumos * margen / 100 -- margen is stored as a PERCENTAGE (e.g. 300 means the price is 300% of cost), see modules/precios/domain/calcular-cotizacion.ts. Versioned (INV-PR-001): editing the margin never UPDATEs this row -- the application closes the open row (vigente_hasta) and INSERTs a new one in the same transaction, so a cotizacion that referenced a version keeps meaning what it meant. At most one OPEN row (vigente_hasta IS NULL) per tenant -- see regla_precio_una_vigente_por_tenant below.';

COMMENT ON COLUMN fsj.regla_precio.margen IS 'Percentage, e.g. 300.00 = price is 3x cost (DP-09: "cost x margin percentage", no fixed fee, no variation by forma farmaceutica).';

SELECT fsj.setup_tenant_table('fsj.regla_precio');

-- INV-PR-001: only vigente_hasta may ever be written after insert (the
-- "close" half of the versioning operation, mirroring
-- designacion_director_tecnico's cese -- migration 0005). margen,
-- vigente_desde, creado_por_id are immutable forever; vigente_hasta itself
-- is final once set. No DELETE grant either (a regla_precio version is
-- never deleted) -- forbid_delete below is the defense-in-depth backstop,
-- same convention as fsj.usuario (INV-U03) and fsj.designacion_director_tecnico.
GRANT UPDATE (vigente_hasta) ON fsj.regla_precio TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.regla_precio_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.margen IS DISTINCT FROM OLD.margen THEN
    RAISE EXCEPTION 'INV-PR-001: margen cannot be modified -- close this rule (vigente_hasta) and insert a new version instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde THEN
    RAISE EXCEPTION 'INV-PR-001: vigente_desde cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.creado_por_id IS DISTINCT FROM OLD.creado_por_id THEN
    RAISE EXCEPTION 'INV-PR-001: creado_por_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.vigente_hasta IS NOT NULL AND NEW.vigente_hasta IS DISTINCT FROM OLD.vigente_hasta THEN
    RAISE EXCEPTION 'INV-PR-001: vigente_hasta cannot be modified once set (closing a rule is final)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.regla_precio_validar_update() IS
  'INV-PR-001: a regla_precio row is immutable except for ONE write -- setting vigente_hasta the first time (the close). Everything else, including re-setting vigente_hasta, is rejected.';

CREATE TRIGGER trg_regla_precio_validar_update
  BEFORE UPDATE ON fsj.regla_precio
  FOR EACH ROW EXECUTE FUNCTION fsj.regla_precio_validar_update();

CREATE TRIGGER trg_regla_precio_forbid_delete
  BEFORE DELETE ON fsj.regla_precio
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- At most one OPEN rule per tenant (task instruction: "enforce it in the
-- DB, a partial unique index or an EXCLUDE" -- a plain partial unique index
-- is sufficient since there is never more than one NULL-vigente_hasta row
-- to compare against; there is no period-overlap to exclude).
CREATE UNIQUE INDEX regla_precio_una_vigente_por_tenant
  ON fsj.regla_precio (tenant_id)
  WHERE vigente_hasta IS NULL;

COMMENT ON INDEX fsj.regla_precio_una_vigente_por_tenant IS
  'At most one OPEN (vigente_hasta IS NULL) regla_precio per tenant -- the application must close the current one in the SAME transaction it inserts a new one, or this rejects the insert.';

-- ============================================================================
-- cotizacion (M10 FASE 7.4) -- tenant-scoped, fully insert-only
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.cotizacion (
  id                uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  item_receta_id    uuid NOT NULL,
  costo_insumos     numeric NOT NULL,
  margen_aplicado   numeric NOT NULL,
  precio_final      numeric NOT NULL,
  regla_precio_id   uuid NOT NULL,
  es_parcial        boolean NOT NULL DEFAULT false,
  es_incompleta     boolean NOT NULL DEFAULT false,
  detalle           jsonb NOT NULL,
  calculada_en      timestamptz NOT NULL DEFAULT now(),
  calculada_por_id  uuid NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT cotizacion_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT cotizacion_item_receta_fkey FOREIGN KEY (tenant_id, item_receta_id) REFERENCES fsj.item_receta (tenant_id, id),
  CONSTRAINT cotizacion_regla_precio_fkey FOREIGN KEY (tenant_id, regla_precio_id) REFERENCES fsj.regla_precio (tenant_id, id),
  CONSTRAINT cotizacion_calculada_por_fkey FOREIGN KEY (tenant_id, calculada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT cotizacion_costo_insumos_check CHECK (costo_insumos >= 0),
  CONSTRAINT cotizacion_margen_aplicado_check CHECK (margen_aplicado >= 0),
  CONSTRAINT cotizacion_precio_final_check CHECK (precio_final >= 0)
);

COMMENT ON TABLE fsj.cotizacion IS
  'M10 FASE 7.4 (DP-09 RESUELTA). Fully insert-only (no UPDATE/DELETE/TRUNCATE grant at all -- see REVOKE below): previous cotizaciones are NEVER deleted or modified (INV-R06 task instruction). "Vigente" = the row with the greatest calculada_en for a given item_receta_id -- an [APP] read-time rule (see modules/precios/infrastructure/cotizacion-repository.ts), not a DB pointer/flag. es_parcial: the ficha costed has at least one enrase-manual linea_pesaje, which contributes 0 to costo_insumos (no computable quantity -- never invented). es_incompleta: at least one non-manual linea could not be FULLY costed for lack of available partida stock (costed partially, the rest recorded as shortfall) -- see detalle for the per-linea breakdown. NOT audited (INV-A01 explicitly excludes cotizaciones, plan section 14).';

COMMENT ON COLUMN fsj.cotizacion.detalle IS
  'Per-linea breakdown: droga, cantidad requerida, partidas used for costing (id, cantidad, costo_unitario, subtotal), and any faltante (shortfall) -- see modules/precios/domain/calcular-cotizacion.ts''s LineaCotizacionDetalle for the exact shape.';

SELECT fsj.setup_tenant_table('fsj.cotizacion');

-- Insert-only: no UPDATE/DELETE/TRUNCATE grant for fsj_app at all (explicit
-- REVOKE, same defense-in-depth convention as fsj.ficha_tecnica/
-- fsj.linea_pesaje -- migration 0012 -- even though ALTER DEFAULT
-- PRIVILEGES never grants these in the first place).
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.cotizacion FROM fsj_app;

CREATE TRIGGER trg_cotizacion_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.cotizacion
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- INV-R06: "vigente" lookup (ORDER BY calculada_en DESC LIMIT 1) and the
-- history listing both filter on (tenant_id, item_receta_id) and sort by
-- calculada_en -- this index serves both directly.
CREATE INDEX cotizacion_item_receta_calculada_idx
  ON fsj.cotizacion (tenant_id, item_receta_id, calculada_en DESC);
