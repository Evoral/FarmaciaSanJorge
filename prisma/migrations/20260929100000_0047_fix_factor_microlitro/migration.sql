-- 0047_fix_factor_microlitro
--
-- Migration 0006 seeded MICROLITRO with factor_a_base = 0.000001, but the
-- VOLUMEN base unit is MILILITRO: 1 mcL = 0.001 mL. The seeded value was off
-- by a factor of 1000 (it is the factor to LITRO, not to mL), so any
-- fsj.convertir() through mcL and every quantity displayed in mcL was wrong.
--
-- Verified before writing this (2026-09-29): MICROLITRO has usada = false
-- and no row references it, so no stored quantity was ever converted with
-- the wrong factor and INV-M04 (factor immutable once used) does not block
-- the fix. The guard below keeps it that way on any other database: if the
-- unit HAS been used there, stored quantities need a reviewed data fix, and
-- this migration refuses to silently change the factor under them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.unidad_medida WHERE codigo = 'MICROLITRO' AND usada) THEN
    RAISE EXCEPTION '0047: MICROLITRO was already used; its stored quantities need a reviewed data fix before correcting factor_a_base';
  END IF;
END;
$$;

UPDATE fsj.unidad_medida
SET factor_a_base = 0.001
WHERE codigo = 'MICROLITRO';
