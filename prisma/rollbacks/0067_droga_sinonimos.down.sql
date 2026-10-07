-- Rollback of 0067_droga_sinonimos. Apply as a NEW forward migration, together
-- with the code that predates docs/specs/sinonimos-droga.md
-- (docs/rollbacks/sinonimos-droga.md has the full procedure).
--
-- DATA LOSS: the synonyms' texto (as typed) and every removed synonym
-- (fecha_baja IS NOT NULL) -- removed rows are deleted so the restored
-- UNIQUE (tenant_id, alias_normalizado) can be created. If two vigente
-- drogas now differ only by accents, re-creating uq_droga_nombre_vigente
-- still succeeds (citext is accent-sensitive), so nothing else is lost.

DROP TRIGGER IF EXISTS trg_droga_baja_quita_sinonimos ON fsj.droga;
DROP FUNCTION IF EXISTS fsj.droga_baja_quita_sinonimos();

DROP TRIGGER IF EXISTS trg_droga_alias_validar ON fsj.droga_alias;
DROP FUNCTION IF EXISTS fsj.droga_alias_validar();

DROP TRIGGER IF EXISTS trg_droga_nombre_no_es_sinonimo ON fsj.droga;
DROP FUNCTION IF EXISTS fsj.droga_nombre_no_es_sinonimo();

DROP INDEX IF EXISTS fsj.uq_droga_nombre_normalizado_vigente;
CREATE UNIQUE INDEX IF NOT EXISTS uq_droga_nombre_vigente
  ON fsj.droga (tenant_id, nombre)
  WHERE fecha_baja IS NULL;

COMMENT ON TABLE fsj.droga IS
  'M06. No stock column here on purpose (INV-S01) -- see fsj.v_stock_droga (migration 0008). unidad_base_id references the GLOBAL unidad_medida catalog (DP-39), not a composite FK. INV-DRG-001 (unidad_base_id/tipo_control immutable once used) is NOT enforced -- DP-12 unresolved.';

REVOKE UPDATE (fecha_baja) ON fsj.droga_alias FROM fsj_app;
DELETE FROM fsj.droga_alias WHERE fecha_baja IS NOT NULL;
DROP INDEX IF EXISTS fsj.idx_droga_alias_droga_vigente;
DROP INDEX IF EXISTS fsj.uq_droga_alias_vigente;
ALTER TABLE fsj.droga_alias
  ADD CONSTRAINT droga_alias_alias_key UNIQUE (tenant_id, alias_normalizado);
ALTER TABLE fsj.droga_alias DROP COLUMN IF EXISTS fecha_baja;
ALTER TABLE fsj.droga_alias DROP CONSTRAINT IF EXISTS droga_alias_texto_no_vacio_check;
ALTER TABLE fsj.droga_alias DROP COLUMN IF EXISTS texto;

COMMENT ON TABLE fsj.droga_alias IS
  'docs/specs/importacion-receta-pdf.md "Pieza 4": remembered equivalence between a drug name as written on an imported receta and a droga of the tenant''s catalog. Created on confirmation of an import when the user ticks "recordar esta equivalencia". Append-only for fsj_app (SELECT/INSERT via ALTER DEFAULT PRIVILEGES, no UPDATE/DELETE).';

DROP FUNCTION IF EXISTS fsj.normalizar_nombre(text);
-- The unaccent extension is left installed: harmless, and something else may use it by then.
