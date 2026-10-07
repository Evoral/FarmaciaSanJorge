-- 0067_droga_sinonimos
--
-- docs/specs/sinonimos-droga.md. A substance is ONE droga (one id: stock,
-- partidas, libro and costs all hang from it); its other names are
-- SYNONYMS -- rows of the existing fsj.droga_alias table (migration 0049),
-- which become first-class: manageable from the droga's screen, searchable
-- in every droga picker, and soft-deleted instead of append-only forever.
-- Names compare accent-, case- and whitespace-insensitively everywhere.
--
--   - extensions.unaccent (Supabase ships it, not installed until now).
--   - fsj.normalizar_nombre(text): IMMUTABLE SQL equivalent of
--     modules/drogas/domain/normalizar.ts's normalizarTexto (strip accents,
--     lower case, collapse whitespace, trim). unaccent(text) is only STABLE
--     (it resolves its dictionary through search_path); the two-argument
--     form with an explicitly qualified dictionary is what makes declaring
--     the wrapper IMMUTABLE safe, so it can back an expression index.
--     Known difference: unaccent also folds a few ligatures NFD keeps
--     (ß -> ss, æ -> ae); every comparison below therefore normalizes BOTH
--     sides with this function, never mixes it with the app's stored form.
--   - fsj.droga_alias: + texto (the synonym as typed, for display; existing
--     rows are backfilled with their normalized form), + fecha_baja (soft
--     delete, one-way). UNIQUE (tenant_id, alias_normalizado) becomes a
--     partial unique index among vigente rows, so a removed synonym can be
--     added again (to the same or another droga). fsj_app gets UPDATE on
--     fecha_baja only.
--   - fsj.droga: uq_droga_nombre_vigente (citext: case-insensitive but
--     accent-sensitive) is replaced by a unique index on
--     (tenant_id, fsj.normalizar_nombre(nombre)) among vigente rows --
--     "Cafeína" and "cafeina" can no longer be two drogas. Checked before
--     writing: no existing vigente drogas collide after normalization.
--   - INV-DRG-002 (two triggers): within a tenant, a vigente synonym never
--     equals the normalized name of a vigente droga, and a droga insert,
--     rename or reactivation never takes a vigente synonym's name. Both
--     triggers take the same transaction-scoped advisory lock on
--     (tenant, normalized name) before checking, so two concurrent
--     transactions cannot each pass the check for the same name.
--   - INV-DRG-003: a removed synonym stays removed (fecha_baja is set once;
--     adding it again creates a new row).
--   - trg_droga_baja_quita_sinonimos: giving a droga de baja removes its
--     vigente synonyms in the same transaction (fecha_baja = the droga's).
--     Reactivating the droga does NOT restore them.
--
-- Numbering: 0066 (20261006180000_0066_etiqueta_tamano) is the highest at
-- the time of writing -- re-check before applying.
--
-- *** APPLY 0067 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0067_droga_sinonimos.down.sql (as a NEW forward
-- migration).

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ============================================================================
-- 1. fsj.normalizar_nombre
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.normalizar_nombre(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_texto)), '\s+', ' ', 'g'));
$$;

COMMENT ON FUNCTION fsj.normalizar_nombre(text) IS
  '0067. Accent-, case- and whitespace-insensitive form of a droga name or synonym (same rule as modules/drogas/domain/normalizar.ts). Backs uq_droga_nombre_normalizado_vigente and every droga search (shared/db/busqueda-droga.ts).';

GRANT EXECUTE ON FUNCTION fsj.normalizar_nombre(text) TO fsj_app;

-- ============================================================================
-- 2. fsj.droga_alias: texto + fecha_baja, vigente-only uniqueness
-- ============================================================================
ALTER TABLE fsj.droga_alias ADD COLUMN IF NOT EXISTS texto text;
UPDATE fsj.droga_alias SET texto = alias_normalizado WHERE texto IS NULL;
ALTER TABLE fsj.droga_alias ALTER COLUMN texto SET NOT NULL;

DO $do$ BEGIN
  ALTER TABLE fsj.droga_alias
    ADD CONSTRAINT droga_alias_texto_no_vacio_check CHECK (length(btrim(texto)) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

ALTER TABLE fsj.droga_alias ADD COLUMN IF NOT EXISTS fecha_baja timestamptz;

-- Same rule as trg_droga_baja_quita_sinonimos (section 5) for drogas already
-- de baja: their remembered equivalences stop blocking those texts.
UPDATE fsj.droga_alias a
SET fecha_baja = d.fecha_baja
FROM fsj.droga d
WHERE d.tenant_id = a.tenant_id
  AND d.id = a.droga_id
  AND d.fecha_baja IS NOT NULL
  AND a.fecha_baja IS NULL;

GRANT UPDATE (fecha_baja) ON fsj.droga_alias TO fsj_app;

ALTER TABLE fsj.droga_alias DROP CONSTRAINT IF EXISTS droga_alias_alias_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_droga_alias_vigente
  ON fsj.droga_alias (tenant_id, alias_normalizado)
  WHERE fecha_baja IS NULL;

CREATE INDEX IF NOT EXISTS idx_droga_alias_droga_vigente
  ON fsj.droga_alias (tenant_id, droga_id)
  WHERE fecha_baja IS NULL;

COMMENT ON TABLE fsj.droga_alias IS
  'Synonyms of a droga (docs/specs/sinonimos-droga.md; created in 0049 for the PDF import''s "recordar esta equivalencia", first-class since 0067). texto = as typed (display); alias_normalizado = normalized by the app (modules/drogas/domain/normalizar.ts), unique among vigente rows per tenant. Soft delete only (fecha_baja, one-way, INV-DRG-003); fsj_app has SELECT/INSERT and UPDATE (fecha_baja), no DELETE. A vigente synonym never equals a vigente droga''s normalized name (INV-DRG-002).';
COMMENT ON COLUMN fsj.droga_alias.texto IS
  '0067. The synonym as the user wrote it (rows from before 0067 hold their normalized form).';
COMMENT ON COLUMN fsj.droga_alias.fecha_baja IS
  '0067. Set when the synonym is removed, or when its droga is given de baja (trg_droga_baja_quita_sinonimos). Never cleared.';

-- ============================================================================
-- 3. fsj.droga: accent-insensitive vigente-name uniqueness
-- ============================================================================
DROP INDEX IF EXISTS fsj.uq_droga_nombre_vigente;
CREATE UNIQUE INDEX IF NOT EXISTS uq_droga_nombre_normalizado_vigente
  ON fsj.droga (tenant_id, fsj.normalizar_nombre(nombre))
  WHERE fecha_baja IS NULL;

COMMENT ON TABLE fsj.droga IS
  'M06. No stock column here on purpose (INV-S01) -- see fsj.v_stock_droga (migration 0008). unidad_base_id references the GLOBAL unidad_medida catalog (DP-39), not a composite FK. Vigente names are unique per tenant after fsj.normalizar_nombre (0067) and never equal a vigente synonym (fsj.droga_alias, INV-DRG-002).';

-- ============================================================================
-- 4. INV-DRG-002 / INV-DRG-003 triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.droga_nombre_no_es_sinonimo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_norm text;
BEGIN
  IF NEW.fecha_baja IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Only a new vigente name needs checking: an insert, a rename, or a reactivation.
  IF TG_OP = 'UPDATE'
     AND OLD.fecha_baja IS NULL
     AND fsj.normalizar_nombre(NEW.nombre) = fsj.normalizar_nombre(OLD.nombre) THEN
    RETURN NEW;
  END IF;

  v_norm := fsj.normalizar_nombre(NEW.nombre);
  PERFORM pg_advisory_xact_lock(hashtextextended('fsj.nombre_droga:' || NEW.tenant_id::text || ':' || v_norm, 0));

  IF EXISTS (
    SELECT 1 FROM fsj.droga_alias a
    WHERE a.tenant_id = NEW.tenant_id
      AND a.fecha_baja IS NULL
      AND fsj.normalizar_nombre(a.alias_normalizado) = v_norm
  ) THEN
    RAISE EXCEPTION 'INV-DRG-002: droga name "%" is already a vigente synonym in this tenant', NEW.nombre
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.droga_nombre_no_es_sinonimo() IS
  '0067, INV-DRG-002 (droga side). App-side twin with a readable message: modules/drogas/application/crear-droga.ts / editar-droga.ts / reactivar-droga.ts (existeNombreVigente).';

DROP TRIGGER IF EXISTS trg_droga_nombre_no_es_sinonimo ON fsj.droga;
CREATE TRIGGER trg_droga_nombre_no_es_sinonimo
  BEFORE INSERT OR UPDATE OF nombre, fecha_baja ON fsj.droga
  FOR EACH ROW EXECUTE FUNCTION fsj.droga_nombre_no_es_sinonimo();

CREATE OR REPLACE FUNCTION fsj.droga_alias_validar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_norm text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.fecha_baja IS NOT NULL THEN
    RAISE EXCEPTION 'INV-DRG-003: droga_alias % was already removed and cannot change', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.fecha_baja IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_norm := fsj.normalizar_nombre(NEW.alias_normalizado);
  PERFORM pg_advisory_xact_lock(hashtextextended('fsj.nombre_droga:' || NEW.tenant_id::text || ':' || v_norm, 0));

  IF EXISTS (
    SELECT 1 FROM fsj.droga d
    WHERE d.tenant_id = NEW.tenant_id
      AND d.fecha_baja IS NULL
      AND fsj.normalizar_nombre(d.nombre) = v_norm
  ) THEN
    RAISE EXCEPTION 'INV-DRG-002: synonym "%" is already the name of a vigente droga in this tenant', NEW.texto
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.droga_alias_validar() IS
  '0067, INV-DRG-002 (synonym side) and INV-DRG-003 (a removed synonym is final). App-side twin: modules/drogas/application/agregar-sinonimo.ts and the import flows'' "recordar esta equivalencia".';

DROP TRIGGER IF EXISTS trg_droga_alias_validar ON fsj.droga_alias;
CREATE TRIGGER trg_droga_alias_validar
  BEFORE INSERT OR UPDATE ON fsj.droga_alias
  FOR EACH ROW EXECUTE FUNCTION fsj.droga_alias_validar();

-- ============================================================================
-- 5. Droga baja removes its synonyms
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.droga_baja_quita_sinonimos()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE fsj.droga_alias
  SET fecha_baja = NEW.fecha_baja
  WHERE tenant_id = NEW.tenant_id
    AND droga_id = NEW.id
    AND fecha_baja IS NULL;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fsj.droga_baja_quita_sinonimos() IS
  '0067. A droga given de baja keeps no vigente synonyms (they would otherwise block those names forever, and resolve imports to a baja droga). Same transaction as the baja; reactivation does not restore them.';

DROP TRIGGER IF EXISTS trg_droga_baja_quita_sinonimos ON fsj.droga;
CREATE TRIGGER trg_droga_baja_quita_sinonimos
  AFTER UPDATE OF fecha_baja ON fsj.droga
  FOR EACH ROW
  WHEN (OLD.fecha_baja IS NULL AND NEW.fecha_baja IS NOT NULL)
  EXECUTE FUNCTION fsj.droga_baja_quita_sinonimos();
