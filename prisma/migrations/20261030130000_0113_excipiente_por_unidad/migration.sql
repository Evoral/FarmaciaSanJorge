-- 0113 -- Excipiente loaded per unidad (openspec/specs/excipiente-preparacion/spec.md).
--
-- In a forma counted by units (CAPSULA, COMPRIMIDO, OVULO, SUPOSITORIO) the excipiente may be typed as the weight of
-- one unit (one cápsula) instead of the whole preparado (c.s.p.); either way the drogas are subtracted. The libro's
-- fórmula then carries the excipiente per dosis ("Ludipress 0,795 g c.s.p."), in excipiente_texto.
--
--   1. fsj.excipiente_borrador.por_unidad: the draft's `cantidad` is one unit's weight (true) or the preparado's (false).
--   2. fsj.preparacion.excipiente_cantidad_por_unidad: the excipiente in one unit, NULL when typed as c.s.p.;
--      excipiente_cantidad keeps the total (what is reserved and descontado). Changes only while INICIADA (INV-P08),
--      like the other excipiente columns.
--
-- Additive for old code: nothing writes the new columns (por_unidad defaults to false = c.s.p.).
-- New code without 0113: the toma page fails (it reads por_unidad).
-- *** APPLY 0113 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Numbering: 0112 (20261030120000_0112_concentracion_componente) is the highest at the time of writing -- re-check
-- before applying.
-- Rollback: prisma/rollbacks/0113_excipiente_por_unidad.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. excipiente_borrador.por_unidad
-- ============================================================================
ALTER TABLE fsj.excipiente_borrador ADD COLUMN IF NOT EXISTS por_unidad boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fsj.excipiente_borrador.por_unidad IS
  '0113. true = cantidad is one unit''s weight (formas counted by units); false = the preparado''s weight (c.s.p.).';

GRANT UPDATE (por_unidad) ON fsj.excipiente_borrador TO fsj_app;

-- ============================================================================
-- 2. preparacion.excipiente_cantidad_por_unidad
-- ============================================================================
ALTER TABLE fsj.preparacion ADD COLUMN IF NOT EXISTS excipiente_cantidad_por_unidad numeric;

DO $do$ BEGIN
  ALTER TABLE fsj.preparacion
    ADD CONSTRAINT preparacion_excipiente_cantidad_por_unidad_check CHECK (
      excipiente_cantidad_por_unidad IS NULL OR (excipiente_droga_id IS NOT NULL AND excipiente_cantidad_por_unidad > 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON COLUMN fsj.preparacion.excipiente_cantidad_por_unidad IS
  '0113. The excipiente in one unit (droga''s unidad base), NULL when typed as c.s.p.; excipiente_cantidad is the total.';

GRANT UPDATE (excipiente_cantidad_por_unidad) ON fsj.preparacion TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.preparacion_validar_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.excipiente_texto IS DISTINCT FROM OLD.excipiente_texto
      OR NEW.excipiente_droga_id IS DISTINCT FROM OLD.excipiente_droga_id
      OR NEW.excipiente_cantidad IS DISTINCT FROM OLD.excipiente_cantidad
      OR NEW.excipiente_cantidad_por_unidad IS DISTINCT FROM OLD.excipiente_cantidad_por_unidad)
     AND OLD.estado <> 'INICIADA' THEN
    RAISE EXCEPTION 'INV-P08: the excipiente can only change while the preparacion is INICIADA (is %)', OLD.estado
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.excipiente_droga_id IS NOT NULL AND NEW.excipiente_droga_id IS DISTINCT FROM OLD.excipiente_droga_id
     AND NOT EXISTS (SELECT 1 FROM fsj.droga d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.excipiente_droga_id AND d.clase = 'EXCIPIENTE') THEN
    RAISE EXCEPTION 'preparacion.excipiente_droga_id % is not a droga of clase EXCIPIENTE', NEW.excipiente_droga_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_excipiente() IS
  '0083/0092/0113, INV-P08: the excipiente (texto, droga, cantidad, cantidad por unidad) changes only while INICIADA; the droga must be of clase EXCIPIENTE.';

DROP TRIGGER IF EXISTS trg_preparacion_validar_excipiente ON fsj.preparacion;
CREATE TRIGGER trg_preparacion_validar_excipiente
  BEFORE UPDATE OF excipiente_texto, excipiente_droga_id, excipiente_cantidad, excipiente_cantidad_por_unidad ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.preparacion_validar_excipiente();
