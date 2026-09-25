-- 0042_archivo_destruccion
--
-- FASE 12, points 12.1-12.3 (M15). DP-26 PARCIAL (user decision, 2026-09-24):
-- retention periods are now per-tenant parameters (`plazo_archivo_comun_anios`,
-- default 2; `plazo_archivo_controladas_anios`, default 3) -- still to be
-- confirmed against actual Mendoza regulation, but the system needs a
-- concrete default to compute `vencimiento` today. The system keeps ALL
-- digital data forever -- "destruction" only ever means the physical papers;
-- nothing here deletes or mutates receta/asiento/adjunto rows.
--
-- Three independent additions to migration 0016's schema:
--   1. Per-tenant lote numbering (`numero`), same "gap-tolerant counter
--      table + BEFORE INSERT SECURITY DEFINER trigger" shape as
--      `fsj.receta_numero_contador` / `fsj.receta_asignar_numero_interno()`
--      (migration 0011) -- deliberately NOT an advisory lock: the counter
--      table's `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is already
--      atomic (the row lock IS the serialization point), so there is no gap
--      on commit, only on a rolled-back INSERT (acceptable per task).
--   2. `plazo_archivo_comun_anios` / `plazo_archivo_controladas_anios`
--      parametro rows, seeded for every EXISTING tenant here (ON CONFLICT DO
--      NOTHING, same convention as migration 0038/0040) -- new tenants get
--      them from scripts/create-tenant.ts (updated alongside this migration).
--   3. INV-ARC-007 (new): a receta whose fórmula uses a controlled droga
--      (receta -> item_receta -> componente_item_receta -> droga.es_controlada)
--      can only be assigned (`receta.lote_archivo_id`) to a lote that already
--      has `incluye_controladas = true`. Extends migration 0016's
--      `fsj.receta_validar_archivo()` trigger function (same trigger,
--      `trg_receta_validar_archivo`, no new trigger needed) -- the app
--      (`conformarLote`, modules/archivo) computes `incluye_controladas`
--      from the selected recetas BEFORE inserting the lote row, in the same
--      transaction, so this is defense in depth, not the primary mechanism.

-- ============================================================================
-- 1. Per-tenant parameters (DP-26 PARCIAL).
-- ============================================================================
INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'plazo_archivo_comun_anios',
  'NUMERO',
  '2',
  'Anios de conservacion en archivo fisico para lotes SIN recetas controladas antes de considerar cumplido el plazo (DP-26 PARCIAL, a confirmar con normativa de Mendoza) -- FASE 12 punto 12.1/12.2'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'plazo_archivo_controladas_anios',
  'NUMERO',
  '3',
  'Anios de conservacion en archivo fisico para lotes CON al menos una receta controlada antes de considerar cumplido el plazo (DP-26 PARCIAL, a confirmar con normativa de Mendoza) -- FASE 12 punto 12.1/12.2'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

-- ============================================================================
-- 2. Per-tenant lote numbering (own copy of migration 0011's
--    fsj.receta_numero_contador / fsj.receta_asignar_numero_interno()).
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.lote_archivo_numero_contador (
  tenant_id    uuid PRIMARY KEY REFERENCES fsj.tenant (id),
  ultimo_valor bigint NOT NULL DEFAULT 0
);

COMMENT ON TABLE fsj.lote_archivo_numero_contador IS
  'Backs lote_archivo_recetas.numero (per-tenant, gap-tolerant on rollback only -- see migration header). Written ONLY by fsj.lote_archivo_recetas_asignar_numero(). Same shape as fsj.receta_numero_contador (migration 0011).';

-- Global-shaped table (tenant_id IS the PK) -- same manual RLS as
-- fsj.receta_numero_contador, since it has no surrogate id for setup_tenant_table.
ALTER TABLE fsj.lote_archivo_numero_contador ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsj.lote_archivo_numero_contador FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fsj.lote_archivo_numero_contador;
CREATE POLICY tenant_isolation ON fsj.lote_archivo_numero_contador
  USING (tenant_id = fsj.current_tenant_id())
  WITH CHECK (tenant_id = fsj.current_tenant_id());

-- ALTER DEFAULT PRIVILEGES only ever grants SELECT/INSERT to fsj_app; revoke
-- the INSERT explicitly -- only the SECURITY DEFINER trigger below may write
-- this table (same convention as fsj.receta_numero_contador).
REVOKE INSERT ON fsj.lote_archivo_numero_contador FROM fsj_app;

ALTER TABLE fsj.lote_archivo_recetas ADD COLUMN IF NOT EXISTS numero bigint;

-- Backfill any pre-existing rows (none expected in a fresh environment, but
-- this migration must be safe either way), ordered by registrado_en per
-- tenant -- same ordering the task's user decision 2 specifies.
WITH ordenado AS (
  SELECT id, tenant_id, row_number() OVER (PARTITION BY tenant_id ORDER BY registrado_en, id) AS rn
  FROM fsj.lote_archivo_recetas
  WHERE numero IS NULL
)
UPDATE fsj.lote_archivo_recetas l
SET numero = o.rn
FROM ordenado o
WHERE l.id = o.id;

ALTER TABLE fsj.lote_archivo_recetas ALTER COLUMN numero SET NOT NULL;

ALTER TABLE fsj.lote_archivo_recetas
  ADD CONSTRAINT lote_archivo_recetas_numero_key UNIQUE (tenant_id, numero);

COMMENT ON COLUMN fsj.lote_archivo_recetas.numero IS
  'Per-tenant correlative, assigned by fsj.lote_archivo_recetas_asignar_numero() -- never set by the app (same discipline as receta.numero_interno). Displayed as "Lote Nro X".';

-- Seed the counter from any backfilled rows so the NEXT insert continues
-- from the highest existing numero per tenant.
INSERT INTO fsj.lote_archivo_numero_contador (tenant_id, ultimo_valor)
SELECT tenant_id, max(numero) FROM fsj.lote_archivo_recetas GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE SET ultimo_valor = EXCLUDED.ultimo_valor;

CREATE OR REPLACE FUNCTION fsj.lote_archivo_recetas_asignar_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_numero bigint;
BEGIN
  INSERT INTO fsj.lote_archivo_numero_contador (tenant_id, ultimo_valor)
  VALUES (NEW.tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE
    SET ultimo_valor = fsj.lote_archivo_numero_contador.ultimo_valor + 1
  RETURNING ultimo_valor INTO v_numero;

  NEW.numero := v_numero;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.lote_archivo_recetas_asignar_numero() IS
  'Assigns lote_archivo_recetas.numero from fsj.lote_archivo_numero_contador, upserting the counter row lazily on first use per tenant. SECURITY DEFINER so it can write the counter table, which fsj_app has no direct grant on. Same shape as fsj.receta_asignar_numero_interno() (migration 0011).';

CREATE TRIGGER trg_lote_archivo_recetas_asignar_numero
  BEFORE INSERT ON fsj.lote_archivo_recetas
  FOR EACH ROW EXECUTE FUNCTION fsj.lote_archivo_recetas_asignar_numero();

-- ============================================================================
-- 3. INV-ARC-007: a receta with a controlled component can only be assigned
--    to a lote that already has incluye_controladas = true. Extends
--    migration 0016's fsj.receta_validar_archivo() (same trigger).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_archivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lote_incluye_controladas boolean;
  v_receta_es_controlada     boolean;
BEGIN
  IF NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id AND NEW.lote_archivo_id IS NOT NULL THEN
    IF NEW.estado NOT IN ('ENTREGADA', 'ANULADA') OR NOT NEW.receta_fisica_recibida THEN
      RAISE EXCEPTION 'INV-ARC-006: receta % can only be archived when ENTREGADA/ANULADA and receta_fisica_recibida', NEW.id
        USING ERRCODE = 'P0001';
    END IF;

    -- INV-ARC-007 (migration 0042): the target lote must already reflect
    -- this receta's controlled/common nature.
    SELECT incluye_controladas INTO v_lote_incluye_controladas
    FROM fsj.lote_archivo_recetas
    WHERE tenant_id = NEW.tenant_id AND id = NEW.lote_archivo_id;

    SELECT EXISTS (
      SELECT 1
      FROM fsj.item_receta ir
      JOIN fsj.componente_item_receta c ON c.tenant_id = ir.tenant_id AND c.item_receta_id = ir.id
      JOIN fsj.droga d ON d.tenant_id = c.tenant_id AND d.id = c.droga_id
      WHERE ir.tenant_id = NEW.tenant_id AND ir.receta_id = NEW.id AND d.es_controlada = true
    ) INTO v_receta_es_controlada;

    IF v_receta_es_controlada AND NOT coalesce(v_lote_incluye_controladas, false) THEN
      RAISE EXCEPTION 'INV-ARC-007: receta % uses a controlled droga and cannot be assigned to lote % (incluye_controladas = false)', NEW.id, NEW.lote_archivo_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF OLD.lote_archivo_id IS NOT NULL AND NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id THEN
    RAISE EXCEPTION 'INV-ARC-006: receta.lote_archivo_id cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_archivo() IS
  'INV-ARC-006 (migration 0016) + INV-ARC-007 (migration 0042): lote_archivo_id is only settable once ENTREGADA/ANULADA + receta_fisica_recibida, frozen once set, and (new) a controlled receta can only join a lote with incluye_controladas = true.';
