-- 0070_receta_domicilio_paciente
--
-- docs/specs/importacion-receta-pdf.md, "Domicilio del paciente". The
-- patient's home address as written on the receta, kept PER RECETA (not on
-- fsj.paciente): the address at prescription time is what matters for a
-- complaint or claim, and it may differ between recetas of the same
-- paciente. Optional free text; the app trims it, stores '' as NULL and caps
-- its length (modules/recetas/domain/receta.ts, MAX_DOMICILIO_PACIENTE).
-- Prefilled by the RCTA PDF import (the "- " line right after "Rp./"),
-- loadable and editable by hand like the diagnóstico.
--
-- ADDITIVE: one nullable column on fsj.receta, no backfill (existing recetas
-- stay NULL).
--
--   - Column-level UPDATE grant: fsj.receta's UPDATE privilege is granted
--     PER COLUMN (0011, 0016, 0049, 0057), so the edit needs its own grant.
--   - Triggers checked (latest definitions, as in 0057's header): the three
--     `BEFORE UPDATE OF estado` triggers (0061), the archivo check
--     (`BEFORE UPDATE OF lote_archivo_id`), forbid_tenant_id_change (0001)
--     and 0057's INV-U07 trigger (tomada_por_id NULL -> value only) never
--     fire on, or look at, this column. RLS (tenant_isolation, 0011's
--     setup_tenant_table) is row-based and covers it as-is.
--   - Auditing is app-level (shared/audit): crear/editar/importar receta
--     include the field in their audit payload.
--   - Not part of the libro recetario asiento or its hash (0034): the libro
--     copies its own paciente data, nothing reads this column.
--
-- Numbering: 0069 (20261007180000_0069_componente_sinonimo) is the highest
-- at the time of writing -- re-check before applying. Independent of 0067/0069.
--
-- *** APPLY 0070 BEFORE DEPLOYING THE CODE THAT USES IT (the new code reads
-- and writes domicilio_paciente). The previous code is unaffected by it. ***
-- Rollback: prisma/rollbacks/0070_receta_domicilio_paciente.down.sql (as a
-- NEW forward migration).

ALTER TABLE fsj.receta ADD COLUMN IF NOT EXISTS domicilio_paciente text;

GRANT UPDATE (domicilio_paciente) ON fsj.receta TO fsj_app;

COMMENT ON COLUMN fsj.receta.domicilio_paciente IS
  '0070. The patient''s home address as written on this receta (free text, optional; NULL = not loaded). Per receta on purpose, not on fsj.paciente: the address at prescription time. Prefilled by the RCTA PDF import (first "- " line after "Rp./"); editable like the rest of the header.';
