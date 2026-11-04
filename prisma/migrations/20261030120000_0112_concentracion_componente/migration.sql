-- 0112 -- Componentes expressed as a concentration over the item's total ("vitamina B6 5 %", "5 mg/mL").
--
--   1. fsj.modo_expresion gains CONCENTRACION. As in 0111, the new value is only referenced through `::text` in
--      constraints, never as an enum literal, so adding it in this same transaction is safe.
--   2. fsj.componente_item_receta.unidad_referencia_id (nullable, global unidad_medida catalog like unidad_medida_id):
--      the denominator of a "per unit" concentration (mg/mL -> mL). NULL on a CONCENTRACION componente means %
--      (per 100 g or mL of the total). Only a CONCENTRACION componente may carry it; a CONCENTRACION componente
--      requires cantidad > 0 (the prescribed value). The magnitude rules (same magnitude as the total, total in masa
--      or volumen, never on a capsular forma) are app-level: modules/recetas/domain/receta.ts and the ficha
--      calculator (modules/elaboracion/domain/calcular-ficha-tecnica.ts, V10/V11).
--   3. fsj.linea_pesaje.prescripcion (nullable): frozen text of a concentration line ("5 % × 30 mL"), shown next to
--      the quantity to weigh. NULL for every other line, so fichas generated before 0112 stay current.
--
-- Additive for old code: nothing writes the new value or columns. New code without 0112: saving a receta or a
-- ficha fails on the missing columns.
-- *** APPLY 0112 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Numbering: 0111 (20261029130000_0111_lotes_elaborados) is the highest at the time of writing -- re-check before
-- applying.
-- Rollback: prisma/rollbacks/0112_concentracion_componente.down.sql (as a NEW forward migration).

ALTER TYPE fsj.modo_expresion ADD VALUE IF NOT EXISTS 'CONCENTRACION';

ALTER TABLE fsj.componente_item_receta ADD COLUMN IF NOT EXISTS unidad_referencia_id uuid;

DO $do$ BEGIN
  ALTER TABLE fsj.componente_item_receta
    ADD CONSTRAINT componente_item_receta_unidad_referencia_fkey
    FOREIGN KEY (unidad_referencia_id) REFERENCES fsj.unidad_medida (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE fsj.componente_item_receta
    ADD CONSTRAINT componente_item_receta_concentracion_check CHECK (
      (modo_expresion::text = 'CONCENTRACION' AND cantidad IS NOT NULL AND cantidad > 0)
      OR (modo_expresion::text <> 'CONCENTRACION' AND unidad_referencia_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

GRANT UPDATE (unidad_referencia_id) ON fsj.componente_item_receta TO fsj_app;

ALTER TABLE fsj.linea_pesaje ADD COLUMN IF NOT EXISTS prescripcion text;

COMMENT ON COLUMN fsj.componente_item_receta.unidad_referencia_id IS
  '0112. CONCENTRACION only: the denominator unit of a "per unit" concentration (mg/mL -> mL); NULL = % (per 100 g or mL of the total).';
COMMENT ON COLUMN fsj.linea_pesaje.prescripcion IS
  '0112. Frozen text of a concentration line ("5 % × 30 mL"); NULL for every other line.';
