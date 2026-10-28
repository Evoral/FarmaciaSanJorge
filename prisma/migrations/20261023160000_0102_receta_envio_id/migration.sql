-- 0102_receta_envio_id
--
-- docs/specs/alta-receta-idempotente.md. A manual receta alta can be
-- submitted twice when the response of the first submit is lost (network
-- cut, the browser retries or the user presses "Guardar" again on a new
-- page load): two recetas with consecutive numero_interno for the same
-- prescription. The form now sends a random `envio_id` generated once per
-- form instance; the second submit finds the first receta by it instead of
-- creating a new one (modules/recetas/application/crear-receta.ts).
--
-- ADDITIVE: one nullable uuid column on fsj.receta, no backfill (existing
-- recetas and imported ones stay NULL -- the PDF/QR import already dedupes
-- by emisor + nro_receta_emisor).
--
--   - Partial UNIQUE index per tenant: closes the race of two concurrent
--     submits that both miss the lookup (the second one fails on COMMIT).
--   - No UPDATE grant: the column is written only at INSERT (fsj_app has
--     table-level INSERT on fsj.receta since 0011); UPDATE stays per column.
--   - Triggers and RLS: row-based / column-specific, none looks at it.
--   - Not part of the libro recetario asiento or its hash.
--
-- *** APPLY 0102 BEFORE DEPLOYING THE CODE THAT USES IT (Prisma reads of
-- fsj.receta select every scalar). The previous code is unaffected by it. ***
-- Rollback: prisma/rollbacks/0102_receta_envio_id.down.sql (as a NEW forward
-- migration).

ALTER TABLE fsj.receta ADD COLUMN IF NOT EXISTS envio_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_receta_envio
  ON fsj.receta (tenant_id, envio_id)
  WHERE envio_id IS NOT NULL;

COMMENT ON COLUMN fsj.receta.envio_id IS
  'Idempotency key of the manual alta form (one per form instance). NULL for imported and pre-0102 recetas. docs/specs/alta-receta-idempotente.md';
