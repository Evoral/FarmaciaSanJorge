-- 0068_preparacion_fecha_vencimiento
--
-- DP-28 "Vencimiento" (resolved 2026-10-07): a preparado expires N calendar
-- months after its elaboración, N = the per-tenant parameter
-- `meses_vencimiento_preparado` (default 3), and the etiqueta prints it as
-- "Vence: MM/YY". The date is a SNAPSHOT taken when the preparación is
-- confirmed -- changing the parameter later never moves the date of an
-- existing preparado or of a reprinted etiqueta.
--
--   1. fsj.preparacion.fecha_vencimiento (date, NULLable).
--      NO backfill: a preparación confirmed before this migration keeps NULL
--      (its etiqueta keeps the blank "Vence: ______" line). We do not invent
--      a regulatory date retroactively.
--   2. CHECK preparacion_fecha_vencimiento_check: only a CONFIRMADA
--      preparación carries a date. Added validated: every existing row has
--      NULL, so it holds.
--   3. fsj_app: UPDATE on the new column (the grants of this table are per
--      column, migration 0013).
--   4. fsj.preparacion_validar_update() (INV-P05, migration 0013) is
--      re-created VERBATIM plus INV-P07: fecha_vencimiento may change only in
--      the UPDATE that takes the preparación INICIADA -> CONFIRMADA. After
--      that it is frozen -- including a legacy CONFIRMADA row's NULL, which
--      can therefore never be filled in retroactively through the app.
--   5. `meses_vencimiento_preparado` = '3' for every EXISTING tenant (same
--      convention as 0038 / 0042: ON CONFLICT DO NOTHING). New tenants get it
--      from scripts/create-tenant.ts. The app also falls back to 3 for a
--      tenant without the row (modules/preparaciones/infrastructure/
--      preparacion-repository.ts#getMesesVencimientoPreparado).
--
-- Other triggers on fsj.preparacion re-read: the INV-U07 actor trigger (0023)
-- only checks preparada_por_id / descartada_por_id, and the INV-P04
-- constraint trigger (0014) only looks at estado -- neither is affected.
--
-- Numbering: 0067 (20261007090000_0067_droga_sinonimos) is the highest at the
-- time of writing -- re-check before applying.
--
-- *** APPLY 0068 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0068_preparacion_fecha_vencimiento.down.sql (as
-- a NEW forward migration; it discards the snapshotted dates).

-- ============================================================================
-- 1-2. Column + CHECK
-- ============================================================================
ALTER TABLE fsj.preparacion ADD COLUMN IF NOT EXISTS fecha_vencimiento date;

DO $do$ BEGIN
  ALTER TABLE fsj.preparacion
    ADD CONSTRAINT preparacion_fecha_vencimiento_check CHECK (fecha_vencimiento IS NULL OR estado = 'CONFIRMADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON COLUMN fsj.preparacion.fecha_vencimiento IS
  '0068. Expiry date of the preparado, snapshotted when it is CONFIRMADA: the confirmation''s jornada + meses_vencimiento_preparado calendar months (end of month clamped). NULL for a preparación confirmed before 0068 (no retroactive date). Settable only in the INICIADA -> CONFIRMADA UPDATE (INV-P07).';

-- ============================================================================
-- 3. Grant
-- ============================================================================
GRANT UPDATE (fecha_vencimiento) ON fsj.preparacion TO fsj_app;

-- ============================================================================
-- 4. INV-P07: fecha_vencimiento is set once, at confirmation
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

  -- INV-P07 (0068): the expiry is snapshotted in the confirming UPDATE and
  -- frozen afterwards.
  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento
     AND NOT (OLD.estado = 'INICIADA' AND NEW.estado = 'CONFIRMADA') THEN
    RAISE EXCEPTION 'INV-P07: fecha_vencimiento can only be set when the preparacion is confirmed' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_update() IS
  'INV-P05: INICIADA -> CONFIRMADA | DESCARTADA, both terminal. No other transition. Also freezes ficha_tecnica_id/item_receta_id/iniciada_en/iniciada_por_id after insert. INV-P07 (0068): fecha_vencimiento changes only in the INICIADA -> CONFIRMADA UPDATE.';

-- ============================================================================
-- 5. Parameter for every existing tenant
-- ============================================================================
INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'meses_vencimiento_preparado',
  'NUMERO',
  '3',
  'Meses, desde la fecha de elaboracion, tras los cuales vence un preparado; se fija al confirmar la preparacion y se imprime en la etiqueta -- DP-28 Vencimiento'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;
