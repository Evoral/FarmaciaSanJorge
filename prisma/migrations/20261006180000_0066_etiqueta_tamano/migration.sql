-- 0066_etiqueta_tamano
--
-- The etiqueta PDF used to be hardcoded to 100 x 42 mm (DP-28: "the printer
-- is not known"). The farmacia prints on different rolls/printers, so the
-- sizes become configuration: an administrator keeps a list of named sizes
-- (name + width x height in mm) and whoever prints an etiqueta picks one.
-- The label design is drawn in a fixed 100 x 42 space and scaled
-- proportionally onto the chosen page (modules/preparaciones/infrastructure/
-- etiqueta-pdf.ts), so a size is nothing but its measures.
--
-- ADDITIVE: one new tenant-scoped table; nothing existing changes.
--
--   - fsj.etiqueta_tamano: id, tenant_id, nombre, ancho_mm / alto_mm
--     (numeric(5,1), CHECK 10..300 mm), activo (soft delete: a size is never
--     deleted, only deactivated -- fsj_app has no DELETE), created_at,
--     updated_at. UNIQUE (tenant_id, id) for composite FKs, and a unique
--     index on (tenant_id, lower(nombre)) so two sizes of a farmacia can not
--     share a name regardless of case.
--   - fsj.setup_tenant_table: RLS (enabled + forced) + tenant_isolation
--     policy (INV-T01) + forbid_tenant_id_change (INV-T03).
--   - Grants: fsj_app gets SELECT/INSERT through ALTER DEFAULT PRIVILEGES
--     (migration 0000); UPDATE is granted PER COLUMN, only on the editable
--     ones (tenant_id/id/created_at stay immutable for the app).
--   - Seed: one "Estándar 100 x 42 mm" size for every EXISTING tenant, so
--     nobody is left without an option when printing. New tenants get the
--     same row from scripts/create-tenant.ts.
--
-- Numbering: 0065 (20261006150000_0065_componente_sin_orden) is the highest
-- at the time of writing -- re-check before applying.
--
-- *** APPLY 0066 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0066_etiqueta_tamano.down.sql (as a NEW forward
-- migration).

CREATE TABLE IF NOT EXISTS fsj.etiqueta_tamano (
  id          uuid          NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id   uuid          NOT NULL,
  nombre      text          NOT NULL,
  ancho_mm    numeric(5, 1) NOT NULL,
  alto_mm     numeric(5, 1) NOT NULL,
  activo      boolean       NOT NULL DEFAULT true,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT etiqueta_tamano_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT etiqueta_tamano_nombre_check CHECK (length(btrim(nombre)) > 0),
  CONSTRAINT etiqueta_tamano_ancho_check CHECK (ancho_mm BETWEEN 10 AND 300),
  CONSTRAINT etiqueta_tamano_alto_check CHECK (alto_mm BETWEEN 10 AND 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_etiqueta_tamano_tenant_nombre
  ON fsj.etiqueta_tamano (tenant_id, lower(nombre));

COMMENT ON TABLE fsj.etiqueta_tamano IS
  '0066. Page sizes (mm) a farmacia prints its etiquetas on. Managed by the administrator (config.editar); soft delete via activo (no DELETE for fsj_app). The label design is scaled proportionally onto the chosen size.';

SELECT fsj.setup_tenant_table('fsj.etiqueta_tamano');

GRANT UPDATE (nombre, ancho_mm, alto_mm, activo, updated_at) ON fsj.etiqueta_tamano TO fsj_app;

-- Every existing tenant keeps printing on the size the label was designed for.
INSERT INTO fsj.etiqueta_tamano (tenant_id, nombre, ancho_mm, alto_mm)
SELECT t.id, 'Estándar 100 × 42 mm', 100, 42
FROM fsj.tenant t
ON CONFLICT DO NOTHING;
