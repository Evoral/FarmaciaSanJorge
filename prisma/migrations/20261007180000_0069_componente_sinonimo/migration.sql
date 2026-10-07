-- 0069_componente_sinonimo
--
-- docs/specs/sinonimos-droga.md, "Nombre elegido al cargar". A receta
-- componente picked through one of its droga's synonyms ("Acetaminofén" for
-- the droga "Paracetamol") remembers WHICH synonym, so the receta's form,
-- detail and edit keep showing the name the user chose (with the canonical
-- name as a quiet hint). The droga stays the componente's identity: ficha
-- técnica, libro recetario/contralor, etiquetas and PDFs keep reading
-- droga.nombre.
--
--   - fsj.droga_alias: UNIQUE (tenant_id, id, droga_id), the target of the
--     composite FK below (droga_alias.droga_id is not updatable by fsj_app,
--     so the triple is stable).
--   - fsj.componente_item_receta.droga_alias_id (nullable): FK
--     (tenant_id, droga_alias_id, droga_id) -> droga_alias (tenant_id, id,
--     droga_id), MATCH SIMPLE (NULL = picked by its canonical name, no
--     check). The synonym must belong to the same tenant AND the same droga
--     as the componente: changing the componente's droga without clearing
--     or replacing the synonym is rejected by the FK.
--   - A synonym removed later (fecha_baja) stays referenced: the receta
--     keeps showing the name it was loaded with. Synonyms are never deleted
--     by fsj_app (no DELETE grant, INV-DRG-003). Whether the synonym was
--     vigente when it was written is checked by the app
--     (modules/recetas/application/sinonimos-componentes.ts).
--   - fsj_app: column-level UPDATE on droga_alias_id, like the other
--     editable columns of the table (0011). The app re-inserts componentes
--     on edit, it does not update them.
--
-- Numbering: 0067 (20261007090000_0067_droga_sinonimos) is the highest at
-- the time of writing -- re-check before applying. Requires 0067.
--
-- *** APPLY 0069 BEFORE DEPLOYING THE CODE THAT USES IT (the new code reads
-- and writes droga_alias_id). The previous code is unaffected by it. ***
-- Rollback: prisma/rollbacks/0069_componente_sinonimo.down.sql (as a NEW
-- forward migration). Apply it BEFORE 0067's down migration, which deletes
-- removed synonyms that this column may reference.

DO $do$ BEGIN
  ALTER TABLE fsj.droga_alias
    ADD CONSTRAINT droga_alias_tenant_id_droga_key UNIQUE (tenant_id, id, droga_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $do$;

ALTER TABLE fsj.componente_item_receta ADD COLUMN IF NOT EXISTS droga_alias_id uuid;

DO $do$ BEGIN
  ALTER TABLE fsj.componente_item_receta
    ADD CONSTRAINT componente_item_receta_droga_alias_fkey
    FOREIGN KEY (tenant_id, droga_alias_id, droga_id)
    REFERENCES fsj.droga_alias (tenant_id, id, droga_id)
    MATCH SIMPLE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- The FK's referencing side (droga_alias rows are never deleted, but the
-- index keeps "which recetas used this synonym" cheap).
CREATE INDEX IF NOT EXISTS idx_componente_item_receta_droga_alias
  ON fsj.componente_item_receta (tenant_id, droga_alias_id)
  WHERE droga_alias_id IS NOT NULL;

GRANT UPDATE (droga_alias_id) ON fsj.componente_item_receta TO fsj_app;

COMMENT ON COLUMN fsj.componente_item_receta.droga_alias_id IS
  '0069. The synonym of droga_id the componente was picked by (display only: the receta form, detail and edit show it with the canonical name as a hint). NULL = picked by the canonical name. Same tenant and same droga enforced by componente_item_receta_droga_alias_fkey; it may point to a synonym removed later. Ficha, libro, etiquetas and PDFs ignore it (they use droga.nombre).';
