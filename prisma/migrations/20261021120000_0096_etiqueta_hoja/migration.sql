-- 0096_etiqueta_hoja
--
-- The etiqueta PDF used to be the label itself (page = chosen size, 0066), so
-- the printer always dropped it at the sheet's origin. The farmacia prints on
-- plain A4 sheets and wants to fill one over time, printing each etiqueta in
-- the next free spot. From now on the PDF page is the SHEET and the etiqueta is
-- drawn in the cell the user picks (docs/specs/hoja-etiquetas.md). This table
-- holds the sheet: its size and margin. How many etiquetas fit is computed from
-- the sheet and the chosen label size (fsj.etiqueta_tamano, 0066), never stored.
--
-- ADDITIVE: one new tenant-scoped table; nothing existing changes.
--
--   - fsj.etiqueta_hoja: ONE row per tenant (tenant_id is the PK and the
--     tenancy key), ancho_mm / alto_mm / margen_mm (numeric(4, 1)), updated_at.
--     CHECKs: sheet 50..500 mm, margin 0..30 mm, and the usable area (sheet
--     minus both margins) at least 10 mm each way (the smallest label size).
--   - fsj.setup_tenant_table: RLS (enabled + forced) + tenant_isolation policy
--     (INV-T01) + forbid_tenant_id_change (INV-T03).
--   - Grants: fsj_app gets SELECT/INSERT through ALTER DEFAULT PRIVILEGES
--     (migration 0000); UPDATE only on the editable columns.
--   - Seed: A4 portrait (210 x 297 mm) with a 5 mm margin for every EXISTING
--     tenant. New tenants get the same row from scripts/create-tenant.ts.
--
-- The sheet <-> label size fit (a size must fit the sheet at least once) is NOT
-- enforced here: it spans two tables and both are edited only through their use
-- cases (modules/etiqueta-tamanos). Sizes that already exist and do not fit the
-- seeded sheet (wider than 200 mm or taller than 287 mm) are left as they are:
-- the admin list marks them and the print dialogs stop offering them until
-- they are edited.
--
-- Numbering: 0095 (20261020130100_0095_retiro_vencido) is the highest at the
-- time of writing -- re-check before applying.
--
-- *** APPLY 0096 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0096_etiqueta_hoja.down.sql (as a NEW forward
-- migration); see docs/rollbacks/hoja-etiquetas.md.

CREATE TABLE IF NOT EXISTS fsj.etiqueta_hoja (
  tenant_id   uuid          PRIMARY KEY REFERENCES fsj.tenant (id),
  ancho_mm    numeric(4, 1) NOT NULL,
  alto_mm     numeric(4, 1) NOT NULL,
  margen_mm   numeric(4, 1) NOT NULL,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT etiqueta_hoja_ancho_check CHECK (ancho_mm BETWEEN 50 AND 500),
  CONSTRAINT etiqueta_hoja_alto_check CHECK (alto_mm BETWEEN 50 AND 500),
  CONSTRAINT etiqueta_hoja_margen_check CHECK (margen_mm BETWEEN 0 AND 30),
  CONSTRAINT etiqueta_hoja_area_util_check CHECK (ancho_mm - 2 * margen_mm >= 10 AND alto_mm - 2 * margen_mm >= 10)
);

COMMENT ON TABLE fsj.etiqueta_hoja IS
  '0096. The sheet (mm) a farmacia prints its etiquetas on: one row per tenant, managed by the administrator (config.editar). The etiqueta PDF page is this sheet; the grid of cells is computed from it and the chosen label size (fsj.etiqueta_tamano).';

SELECT fsj.setup_tenant_table('fsj.etiqueta_hoja');

GRANT UPDATE (ancho_mm, alto_mm, margen_mm, updated_at) ON fsj.etiqueta_hoja TO fsj_app;

-- Every existing tenant starts on A4 portrait with a 5 mm margin (most printers
-- can not print the outer few mm).
INSERT INTO fsj.etiqueta_hoja (tenant_id, ancho_mm, alto_mm, margen_mm)
SELECT t.id, 210, 297, 5
FROM fsj.tenant t
ON CONFLICT DO NOTHING;
