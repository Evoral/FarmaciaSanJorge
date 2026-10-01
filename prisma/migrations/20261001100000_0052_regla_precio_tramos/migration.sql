-- 0052_regla_precio_tramos
--
-- Business decision confirmed by the user on 2026-10-01 (docs/specs/reglas-precio.md),
-- superseding DP-09's single global margen (migration 0031):
--   1. The markup depends on the COST of the preparacion (each cotizacion /
--      item is priced on its own), by TRAMOS. The tramo's markup applies to
--      the WHOLE cost -- NOT progressive brackets. Example: cost <= 100000 ->
--      +100%, cost > 100000 -> +70%; so cost 100000 sells at 200000 and cost
--      100001 at 170001.70. That price DROP at the boundary is INTENDED by
--      the business and must not be "fixed".
--   2. A minimum price floor: precio_final = max(costo * (1 + margen/100),
--      precio_minimo).
--   3. Any number of tramos, never overlapping. Modeled as an ordered list
--      where each tramo has an INCLUSIVE upper bound costo_hasta (the lower
--      bound is implicitly the previous tramo's costo_hasta, exclusive; the
--      first starts at 0 inclusive) and the LAST one has costo_hasta NULL
--      (no upper limit). Overlaps and gaps are impossible by construction
--      once "costo_hasta strictly increasing, only the last NULL" holds --
--      enforced below (INV-PR-002) and in modules/precios/domain/regla-precio.ts.
--
-- Data model: the versioned header fsj.regla_precio stays (INV-PR-001,
-- unchanged: close the open row + insert a new version in one transaction),
-- so fsj.cotizacion.regla_precio_id keeps pointing at the exact rule set
-- used and history is preserved. It gains precio_minimo; the tramos live in
-- a new child table fsj.regla_precio_tramo, immutable after insert like the
-- header's own content.
--
-- Retiring regla_precio.margen: made NULLABLE and DEPRECATED rather than
-- dropped. Least disruptive option: dropping it would destroy the original
-- value of every historical version (the backfilled tramo below copies it,
-- but the header column is the record the 0031-era audit rows describe) and
-- would force rewriting fsj.regla_precio_validar_update for no gain; keeping
-- it NOT NULL would force the app to keep inventing a value. New versions
-- write NULL; nothing in the app reads it anymore. Its CHECK (margen >= 0)
-- and immutability trigger stay valid for the legacy values.
--
-- Backfill: EVERY existing regla_precio (open AND closed) gets exactly one
-- tramo (orden 1, costo_hasta NULL, its own margen) and precio_minimo 0 --
-- the old formula exactly, so prices are unchanged until an admin saves a
-- new version, and every version (not only the open one) is readable
-- through the same tramo model. Runs as the migration owner (bypasses RLS,
-- same as the backfill in 0051).
--
-- cotizacion: margen_aplicado keeps meaning "the markup actually used" (now:
-- the tramo's). New precio_minimo_aplicado records whether the floor raised
-- the price. Adding a column with a DEFAULT does not fire the insert-only
-- table's UPDATE triggers and needs no new grant.
--
-- Permisos: none added or reassigned -- editing still requires
-- precios.reglas.editar (0002).
--
-- Depends on 0001 (fsj.setup_tenant_table, fsj.forbid_update_delete), 0031
-- (fsj.regla_precio, fsj.cotizacion, fsj.regla_precio_validar_update).

-- ============================================================================
-- 1. regla_precio: precio_minimo + retire margen
-- ============================================================================
-- DEFAULT 0 doubles as the backfill for existing rows and is kept afterwards
-- (same reasoning as 0049's matricula_jurisdiccion): the application always
-- sends it explicitly, and raw-SQL fixtures in tests/db keep inserting
-- headers without it.
ALTER TABLE fsj.regla_precio
  ADD COLUMN IF NOT EXISTS precio_minimo numeric NOT NULL DEFAULT 0;

ALTER TABLE fsj.regla_precio
  ADD CONSTRAINT regla_precio_precio_minimo_check CHECK (precio_minimo >= 0);

ALTER TABLE fsj.regla_precio ALTER COLUMN margen DROP NOT NULL;

COMMENT ON COLUMN fsj.regla_precio.margen IS
  'DEPRECATED (migration 0052): the single global markup of DP-09. NULL for every version created after 0052; kept only as the historical value of older versions. The markup now lives in fsj.regla_precio_tramo.';

COMMENT ON COLUMN fsj.regla_precio.precio_minimo IS
  'Minimum price floor (2026-10-01 rule): precio_final = max(costo * (1 + margen_tramo / 100), precio_minimo). 0 = no floor.';

COMMENT ON TABLE fsj.regla_precio IS
  'M08 versioned price rule set (INV-PR-001): precio_minimo + its tramos (fsj.regla_precio_tramo). Editing never UPDATEs a version -- the application closes the open row (vigente_hasta) and INSERTs a new one with its tramos in the same transaction, so a cotizacion that referenced a version keeps meaning what it meant. At most one OPEN row per tenant (regla_precio_una_vigente_por_tenant). Formula: modules/precios/domain/regla-precio.ts#calcularPrecioFinal.';

-- INV-PR-001 now also covers precio_minimo (fsj_app has no UPDATE grant on
-- it anyway -- 0031 only grants vigente_hasta -- this is the backstop).
CREATE OR REPLACE FUNCTION fsj.regla_precio_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.margen IS DISTINCT FROM OLD.margen THEN
    RAISE EXCEPTION 'INV-PR-001: margen cannot be modified -- close this rule (vigente_hasta) and insert a new version instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.precio_minimo IS DISTINCT FROM OLD.precio_minimo THEN
    RAISE EXCEPTION 'INV-PR-001: precio_minimo cannot be modified -- close this rule (vigente_hasta) and insert a new version instead' USING ERRCODE = 'P0001';
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

-- ============================================================================
-- 2. regla_precio_tramo -- tenant-scoped, fully immutable after insert
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.regla_precio_tramo (
  id               uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  regla_precio_id  uuid NOT NULL,
  -- 1-based position; contiguous 1..n per regla (INV-PR-002 below).
  orden            integer NOT NULL,
  -- INCLUSIVE upper bound of the cost this tramo covers ("more than X" is
  -- strictly greater: a cost exactly equal to costo_hasta belongs HERE).
  -- NULL only on the last tramo (no upper limit).
  costo_hasta      numeric,
  -- Markup PERCENTAGE added on top of the WHOLE cost (not progressive).
  margen           numeric NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT regla_precio_tramo_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT regla_precio_tramo_regla_fkey FOREIGN KEY (tenant_id, regla_precio_id) REFERENCES fsj.regla_precio (tenant_id, id),
  CONSTRAINT regla_precio_tramo_orden_unico UNIQUE (tenant_id, regla_precio_id, orden),
  CONSTRAINT regla_precio_tramo_orden_check CHECK (orden >= 1),
  CONSTRAINT regla_precio_tramo_costo_hasta_check CHECK (costo_hasta IS NULL OR costo_hasta > 0),
  CONSTRAINT regla_precio_tramo_margen_check CHECK (margen >= 0)
);

COMMENT ON TABLE fsj.regla_precio_tramo IS
  'Margin tramos of one regla_precio version (2026-10-01 rule, docs/specs/reglas-precio.md). Ordered by orden; a cost C belongs to the first tramo with C <= costo_hasta (or the last, costo_hasta NULL). The tramo''s margen applies to the WHOLE cost, so the price may DROP across a boundary -- intended. Valid set (INV-PR-002, deferred check): at least one tramo, orden contiguous from 1, costo_hasta strictly increasing, NULL exactly on the last. Fully immutable after insert (no UPDATE/DELETE grant, trigger below) -- a change is a new regla_precio version.';

SELECT fsj.setup_tenant_table('fsj.regla_precio_tramo');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.regla_precio_tramo FROM fsj_app;

CREATE TRIGGER trg_regla_precio_tramo_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.regla_precio_tramo
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- At most one open-ended tramo per version (also implied by INV-PR-002;
-- this one fails at the offending INSERT instead of at COMMIT).
CREATE UNIQUE INDEX regla_precio_tramo_un_sin_tope
  ON fsj.regla_precio_tramo (tenant_id, regla_precio_id)
  WHERE costo_hasta IS NULL;

-- ============================================================================
-- 3. INV-PR-002: the tramo set of a version is valid, checked at COMMIT
--    (DEFERRABLE) -- same two-sided pattern as INV-R03 (migration 0012):
--    fired by the header INSERT (so a version can never end up with ZERO
--    tramos) and by every tramo INSERT. Tramos are insert-only, so INSERT
--    is the only operation that can change a set.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.regla_precio_validar_tramos(p_tenant_id uuid, p_regla_precio_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total     integer;
  v_posicion  integer := 0;
  v_anterior  numeric := NULL;
  r           record;
BEGIN
  SELECT count(*) INTO v_total
  FROM fsj.regla_precio_tramo
  WHERE tenant_id = p_tenant_id AND regla_precio_id = p_regla_precio_id;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'INV-PR-002: regla_precio % must have at least one tramo', p_regla_precio_id
      USING ERRCODE = 'P0001';
  END IF;

  FOR r IN
    SELECT orden, costo_hasta
    FROM fsj.regla_precio_tramo
    WHERE tenant_id = p_tenant_id AND regla_precio_id = p_regla_precio_id
    ORDER BY orden
  LOOP
    v_posicion := v_posicion + 1;
    IF r.orden <> v_posicion THEN
      RAISE EXCEPTION 'INV-PR-002: regla_precio % tramos must be numbered 1..n without gaps (found orden % at position %)', p_regla_precio_id, r.orden, v_posicion
        USING ERRCODE = 'P0001';
    END IF;
    IF v_posicion < v_total AND r.costo_hasta IS NULL THEN
      RAISE EXCEPTION 'INV-PR-002: regla_precio % only the last tramo may have no upper limit (costo_hasta NULL at orden %)', p_regla_precio_id, r.orden
        USING ERRCODE = 'P0001';
    END IF;
    IF v_posicion = v_total AND r.costo_hasta IS NOT NULL THEN
      RAISE EXCEPTION 'INV-PR-002: regla_precio % the last tramo must have no upper limit (costo_hasta NULL)', p_regla_precio_id
        USING ERRCODE = 'P0001';
    END IF;
    IF r.costo_hasta IS NOT NULL AND v_anterior IS NOT NULL AND r.costo_hasta <= v_anterior THEN
      RAISE EXCEPTION 'INV-PR-002: regla_precio % costo_hasta must be strictly increasing (orden %: % <= %)', p_regla_precio_id, r.orden, r.costo_hasta, v_anterior
        USING ERRCODE = 'P0001';
    END IF;
    v_anterior := r.costo_hasta;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION fsj.regla_precio_validar_tramos(uuid, uuid) IS
  'INV-PR-002: a regla_precio version has >= 1 tramo, orden 1..n contiguous, costo_hasta strictly increasing and NULL exactly on the last tramo -- which makes overlaps and gaps impossible. Mirrors modules/precios/domain/regla-precio.ts#validarReglasPrecio.';

CREATE OR REPLACE FUNCTION fsj.trg_regla_precio_tramos_validos()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'regla_precio' THEN
    PERFORM fsj.regla_precio_validar_tramos(NEW.tenant_id, NEW.id);
  ELSE
    PERFORM fsj.regla_precio_validar_tramos(NEW.tenant_id, NEW.regla_precio_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. Backfill (before the constraint triggers exist, so the header rows
--    already in place are not re-checked by anything but the final state).
-- ============================================================================
INSERT INTO fsj.regla_precio_tramo (tenant_id, regla_precio_id, orden, costo_hasta, margen)
SELECT rp.tenant_id, rp.id, 1, NULL, rp.margen
FROM fsj.regla_precio rp
WHERE NOT EXISTS (
  SELECT 1 FROM fsj.regla_precio_tramo t
  WHERE t.tenant_id = rp.tenant_id AND t.regla_precio_id = rp.id
);

CREATE CONSTRAINT TRIGGER trg_regla_precio_tiene_tramos
  AFTER INSERT ON fsj.regla_precio
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_regla_precio_tramos_validos();

CREATE CONSTRAINT TRIGGER trg_regla_precio_tramo_set_valido
  AFTER INSERT ON fsj.regla_precio_tramo
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_regla_precio_tramos_validos();

-- ============================================================================
-- 5. cotizacion: was the floor applied?
-- ============================================================================
ALTER TABLE fsj.cotizacion
  ADD COLUMN IF NOT EXISTS precio_minimo_aplicado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fsj.cotizacion.precio_minimo_aplicado IS
  'true when precio_final was raised to the regla_precio version''s precio_minimo (the tramo price was lower). margen_aplicado is always the tramo''s markup that was evaluated. false for every cotizacion before migration 0052 (there was no floor).';

COMMENT ON COLUMN fsj.cotizacion.margen_aplicado IS
  'The markup percentage of the regla_precio_tramo the cost fell into (before 0052: the single global margen).';
