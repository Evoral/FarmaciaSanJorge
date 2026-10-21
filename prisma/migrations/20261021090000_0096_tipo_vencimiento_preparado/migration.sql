-- 0096_tipo_vencimiento_preparado
--
-- docs/specs/vencimiento-preparado.md R9-R14 (user decision 2026-10-21): when confirming, the pharmacist chooses per
-- ítem a tipo de vencimiento -- ESTANDAR (meses_vencimiento_preparado months, the 0068 behaviour and the default),
-- ACUOSA_CON_CONSERVANTE (35 days) or ACUOSA_SIN_CONSERVANTE (14 days). The tipo is snapshotted next to
-- fecha_vencimiento, so a reprinted etiqueta keeps its day-precise date and its storage note.
--
--   1. Enum fsj.tipo_vencimiento_preparado.
--   2. fsj.preparacion.tipo_vencimiento (NULLable) + CHECK preparacion_tipo_vencimiento_check: only a CONFIRMADA
--      preparación carries one. NO backfill: a preparación confirmed before 0096 keeps NULL (spec R11, as 0068 R6).
--   3. fsj_app: UPDATE on the new column (the grants of this table are per column, migration 0013).
--   4. fsj.preparacion_validar_update() re-created VERBATIM from 0068 plus INV-P07 for tipo_vencimiento: it changes
--      only in the INICIADA -> CONFIRMADA UPDATE, then it is frozen.
--
-- Other triggers on fsj.preparacion re-read: the INV-U07 actor trigger (0023), the INV-P04 constraint trigger (0014)
-- and INV-P08 (0083/0092, excipiente columns) do not look at this column.
--
-- Numbering: 0095 (20261020130100_0095_retiro_vencido) is the highest at the time of writing -- re-check before
-- applying.
--
-- *** APPLY 0096 BEFORE DEPLOYING THE CODE THAT USES IT. The previous code is unaffected: it never reads or writes
-- tipo_vencimiento, and the column is nullable. ***
-- Rollback: prisma/rollbacks/0096_tipo_vencimiento_preparado.down.sql (as a NEW forward migration;
-- docs/rollbacks/tipo-vencimiento-preparado.md).

-- ============================================================================
-- 1. Enum
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.tipo_vencimiento_preparado AS ENUM ('ESTANDAR', 'ACUOSA_CON_CONSERVANTE', 'ACUOSA_SIN_CONSERVANTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- 2. Column + CHECK
-- ============================================================================
ALTER TABLE fsj.preparacion ADD COLUMN IF NOT EXISTS tipo_vencimiento fsj.tipo_vencimiento_preparado;

DO $do$ BEGIN
  ALTER TABLE fsj.preparacion
    ADD CONSTRAINT preparacion_tipo_vencimiento_check CHECK (tipo_vencimiento IS NULL OR estado = 'CONFIRMADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON COLUMN fsj.preparacion.tipo_vencimiento IS
  '0096. Tipo de vencimiento chosen when the preparación was CONFIRMADA: ESTANDAR (meses_vencimiento_preparado months), ACUOSA_CON_CONSERVANTE (35 days), ACUOSA_SIN_CONSERVANTE (14 days). Decides the etiqueta''s date format and storage note. NULL for a preparación confirmed before 0096. Settable only in the INICIADA -> CONFIRMADA UPDATE (INV-P07).';

-- ============================================================================
-- 3. Grant
-- ============================================================================
GRANT UPDATE (tipo_vencimiento) ON fsj.preparacion TO fsj_app;

-- ============================================================================
-- 4. INV-P07: fecha_vencimiento and tipo_vencimiento are set once, at confirmation
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.preparacion_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ficha_tecnica_id IS DISTINCT FROM OLD.ficha_tecnica_id THEN
    RAISE EXCEPTION 'INV-P01: ficha_tecnica_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.item_receta_id IS DISTINCT FROM OLD.item_receta_id THEN
    RAISE EXCEPTION 'INV-P01: item_receta_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.iniciada_en IS DISTINCT FROM OLD.iniciada_en THEN
    RAISE EXCEPTION 'INV-P05: iniciada_en cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.iniciada_por_id IS DISTINCT FROM OLD.iniciada_por_id THEN
    RAISE EXCEPTION 'INV-P05: iniciada_por_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    -- INV-P05: CONFIRMADA never changes state again; DESCARTADA is also terminal.
    IF OLD.estado <> 'INICIADA' THEN
      RAISE EXCEPTION 'INV-P05: invalid preparacion state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.estado NOT IN ('CONFIRMADA', 'DESCARTADA') THEN
      RAISE EXCEPTION 'INV-P05: invalid preparacion state transition % -> %', OLD.estado, NEW.estado
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- INV-P07 (0068, 0096): the expiry and its tipo are snapshotted in the confirming UPDATE and frozen afterwards.
  IF (NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento OR NEW.tipo_vencimiento IS DISTINCT FROM OLD.tipo_vencimiento)
     AND NOT (OLD.estado = 'INICIADA' AND NEW.estado = 'CONFIRMADA') THEN
    RAISE EXCEPTION 'INV-P07: fecha_vencimiento and tipo_vencimiento can only be set when the preparacion is confirmed' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_update() IS
  'INV-P05: INICIADA -> CONFIRMADA | DESCARTADA, both terminal. No other transition. Also freezes ficha_tecnica_id/item_receta_id/iniciada_en/iniciada_por_id after insert. INV-P07 (0068, 0096): fecha_vencimiento and tipo_vencimiento change only in the INICIADA -> CONFIRMADA UPDATE.';
