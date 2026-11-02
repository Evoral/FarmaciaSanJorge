-- 0115 -- The name and aspecto printed on an elaborated lot's etiqueta
-- (change openspec/changes/lotes-elaborados/, spec elaboracion-lote; user decision 2026-11-02).
--
-- The frasco of a dilución is labelled "Clonazepam 1:100", a fórmula lot "Crema Base NO iónica": the name is suggested
-- from the droga (and the dilución's proportion) and edited by the user when elaborating. The aspecto ("Crema blanca")
-- is optional. Both are printed on the lot's etiqueta together with its lote code, the lotes de origen of the drugs it
-- consumed (the trazabilidad an inspection asks for), the elaboration date and the vencimiento.
--
--   1. fsj.elaboracion_lote.nombre (NOT NULL; existing rows: the produced droga's name) and .aspecto (NULL = none).
--      Insert-only like the rest of the row (no UPDATE grant, forbid_update_delete).
--
-- The lote code (`FSJ-DIL-0001`, `FSJ-ELA-0001`: a correlative per tipo that never restarts) is assigned by the app
-- (modules/stock/domain/elaboracion-lote.ts); no schema change.
--
-- *** APPLY 0115 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0115_lote_elaborado_nombre.down.sql (as a NEW forward migration).

ALTER TABLE fsj.elaboracion_lote ADD COLUMN IF NOT EXISTS nombre text;
ALTER TABLE fsj.elaboracion_lote ADD COLUMN IF NOT EXISTS aspecto text;

-- The row is immutable (forbid_update_delete): the trigger is off for this backfill only.
ALTER TABLE fsj.elaboracion_lote DISABLE TRIGGER trg_elaboracion_lote_forbid_update_delete;
UPDATE fsj.elaboracion_lote el
SET nombre = d.nombre
FROM fsj.partida p
JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
WHERE p.tenant_id = el.tenant_id AND p.id = el.partida_id AND el.nombre IS NULL;
ALTER TABLE fsj.elaboracion_lote ENABLE TRIGGER trg_elaboracion_lote_forbid_update_delete;

ALTER TABLE fsj.elaboracion_lote ALTER COLUMN nombre SET NOT NULL;

ALTER TABLE fsj.elaboracion_lote
  ADD CONSTRAINT elaboracion_lote_nombre_check CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
  ADD CONSTRAINT elaboracion_lote_aspecto_check CHECK (aspecto IS NULL OR length(btrim(aspecto)) BETWEEN 1 AND 120);

COMMENT ON COLUMN fsj.elaboracion_lote.nombre IS
  '0115. The name printed on the lot''s etiqueta ("Clonazepam 1:100"): suggested from the droga and the dilución''s proportion, edited when elaborating. Backfilled with the droga''s name.';
COMMENT ON COLUMN fsj.elaboracion_lote.aspecto IS
  '0115. The aspecto printed on the lot''s etiqueta ("Crema blanca"); NULL = none.';
