-- 0049_importacion_receta_pdf
--
-- docs/specs/importacion-receta-pdf.md, "Cambios de esquema (una
-- migración)". Resolves DP-23 (médico matrícula jurisdiction) and DP-29
-- (digital receta origin: the PDF is read, prefilled and discarded -- never
-- stored, so `archivo_adjunto_url` stays NULL for imported recetas).
-- Depends on 0007 (fsj.medico, fsj.droga), 0011 (fsj.receta,
-- fsj.item_receta), 0002 (fsj.usuario).
--
-- Four independent additions:
--   1. receta: emisor / nro_receta_emisor / url_verificacion (provenance of
--      an imported digital receta) + diagnostico_codigo /
--      diagnostico_descripcion (also loadable by hand). The DIGITAL_* origin
--      check now also accepts "has an emisor receta number" instead of an
--      attachment, and the same emisor receta cannot be imported twice
--      unless the earlier one was ANULADA.
--   2. item_receta: posologia / duracion_tratamiento_dias.
--   3. medico.matricula_jurisdiccion (NACIONAL/PROVINCIAL), backfilled to
--      PROVINCIAL; uq_medico_matricula_vigente widens to include it, so the
--      same number can exist once per jurisdiction.
--   4. droga_alias (new, tenant-scoped): remembered "text on the PDF ->
--      droga" equivalences for the import match step.
--
-- Deliberately NOT here: any DB rule excluding DIGITAL_PDF recetas from
-- archive lotes. That is [APP] (modules/archivo's eligibility query and
-- domain predicate), same division of labor as the rest of the archive
-- selection criteria.

-- ============================================================================
-- 1. receta
-- ============================================================================
ALTER TABLE fsj.receta
  ADD COLUMN IF NOT EXISTS emisor                   text,
  ADD COLUMN IF NOT EXISTS nro_receta_emisor        text,
  ADD COLUMN IF NOT EXISTS url_verificacion         text,
  ADD COLUMN IF NOT EXISTS diagnostico_codigo       varchar(10),
  ADD COLUMN IF NOT EXISTS diagnostico_descripcion  text;

COMMENT ON COLUMN fsj.receta.emisor IS
  'Digital receta platform code (e.g. RCTA) -- docs/specs/importacion-receta-pdf.md. Set together with nro_receta_emisor (receta_emisor_nro_pair_check). NULL for recetas loaded by hand.';
COMMENT ON COLUMN fsj.receta.nro_receta_emisor IS
  'The emisor''s own receta number (barcode number on the PDF). Unique per (tenant, emisor) among non-ANULADA recetas (uq_receta_emisor_nro_vigente).';
COMMENT ON COLUMN fsj.receta.url_verificacion IS
  'Optional verification link printed on the digital receta.';
COMMENT ON COLUMN fsj.receta.diagnostico_codigo IS
  'ICD-10 (CIE-10) code, e.g. E66.0. Optional; format enforced by receta_diagnostico_codigo_check.';

ALTER TABLE fsj.receta
  ADD CONSTRAINT receta_emisor_nro_pair_check CHECK (
    (emisor IS NULL) = (nro_receta_emisor IS NULL)
  ),
  ADD CONSTRAINT receta_diagnostico_codigo_check CHECK (
    diagnostico_codigo IS NULL OR diagnostico_codigo ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$'
  );

-- Migration 0011's version required archivo_adjunto_url for every DIGITAL_*
-- origin. An imported PDF is never stored (spec: "El PDF no se almacena"),
-- so the emisor's receta number is accepted as the digital provenance
-- instead.
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_adjunto_digital_check;
ALTER TABLE fsj.receta
  ADD CONSTRAINT receta_adjunto_digital_check CHECK (
    origen NOT IN ('DIGITAL_PDF', 'DIGITAL_FOTO')
    OR archivo_adjunto_url IS NOT NULL
    OR nro_receta_emisor IS NOT NULL
  );

-- A receta anulada por error can be imported again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_receta_emisor_nro_vigente
  ON fsj.receta (tenant_id, emisor, nro_receta_emisor)
  WHERE nro_receta_emisor IS NOT NULL AND estado <> 'ANULADA';

-- emisor / nro_receta_emisor / url_verificacion are provenance, written once
-- at import time -- no UPDATE grant. The diagnóstico is editable like the
-- rest of the receta header.
GRANT UPDATE (diagnostico_codigo, diagnostico_descripcion) ON fsj.receta TO fsj_app;

-- ============================================================================
-- 2. item_receta
-- ============================================================================
ALTER TABLE fsj.item_receta
  ADD COLUMN IF NOT EXISTS posologia                  text,
  ADD COLUMN IF NOT EXISTS duracion_tratamiento_dias  integer;

ALTER TABLE fsj.item_receta
  ADD CONSTRAINT item_receta_duracion_tratamiento_check CHECK (
    duracion_tratamiento_dias IS NULL OR duracion_tratamiento_dias > 0
  );

COMMENT ON COLUMN fsj.item_receta.posologia IS
  'Free-text dosage instruction as prescribed (e.g. "Media dosis cada 12 horas"). Informational only -- the ficha calculator uses fraccion_dosis_por_unidad, not this text.';
COMMENT ON COLUMN fsj.item_receta.duracion_tratamiento_dias IS
  'Prescribed treatment length in days. Informational only (the import compares it against cantidad_unidades as a warning, never a block).';

GRANT UPDATE (posologia, duracion_tratamiento_dias) ON fsj.item_receta TO fsj_app;

-- ============================================================================
-- 3. medico.matricula_jurisdiccion (DP-23)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.jurisdiccion_matricula AS ENUM ('NACIONAL', 'PROVINCIAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- The DEFAULT backfills every existing row to PROVINCIAL (spec) and is kept
-- afterwards: the application always sends the jurisdiction explicitly, and
-- raw-SQL fixtures in tests/db that predate this column keep inserting
-- médicos without it.
ALTER TABLE fsj.medico
  ADD COLUMN IF NOT EXISTS matricula_jurisdiccion fsj.jurisdiccion_matricula NOT NULL DEFAULT 'PROVINCIAL';

COMMENT ON COLUMN fsj.medico.matricula_jurisdiccion IS
  'DP-23 (resolved by docs/specs/importacion-receta-pdf.md): the matrícula''s issuing jurisdiction. Part of the vigente-uniqueness key (uq_medico_matricula_vigente).';

DROP INDEX IF EXISTS fsj.uq_medico_matricula_vigente;
CREATE UNIQUE INDEX IF NOT EXISTS uq_medico_matricula_vigente
  ON fsj.medico (tenant_id, matricula_jurisdiccion, matricula)
  WHERE fecha_baja IS NULL;

GRANT UPDATE (matricula_jurisdiccion) ON fsj.medico TO fsj_app;

COMMENT ON TABLE fsj.medico IS
  'M06. matricula uniqueness is scoped to (jurisdiction, matricula) among active rows per tenant -- DP-23 resolved in migration 0049.';

-- ============================================================================
-- 4. droga_alias -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.droga_alias (
  id                 uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  droga_id           uuid NOT NULL,
  -- Normalized as in docs/specs/importacion-receta-pdf.md "Pieza 4":
  -- lowercase, NFD without diacritics, collapsed whitespace, trimmed
  -- (modules/recetas/domain/normalizar.ts). Written already normalized by
  -- the app; exact comparison only, no fuzzy matching.
  alias_normalizado  text NOT NULL,
  creado_por_id      uuid NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT droga_alias_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT droga_alias_alias_key UNIQUE (tenant_id, alias_normalizado),
  CONSTRAINT droga_alias_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT droga_alias_creado_por_fkey FOREIGN KEY (tenant_id, creado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT droga_alias_alias_no_vacio_check CHECK (length(alias_normalizado) > 0)
);

COMMENT ON TABLE fsj.droga_alias IS
  'docs/specs/importacion-receta-pdf.md "Pieza 4": remembered equivalence between a drug name as written on an imported receta and a droga of the tenant''s catalog. Created on confirmation of an import when the user ticks "recordar esta equivalencia". Append-only for fsj_app (SELECT/INSERT via ALTER DEFAULT PRIVILEGES, no UPDATE/DELETE).';

SELECT fsj.setup_tenant_table('fsj.droga_alias');
