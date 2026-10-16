-- 0083_preparacion_excipiente
--
-- User decision 2026-10-16 (docs/specs/libro-recetario-y-contralor.md, "Excipiente utilizado"): after "Marcar como
-- preparada" the toma workspace shows an optional field for the excipiente actually used (e.g. "Ludipress"). It is
-- saved as it is typed and, at the confirmation ("Imprimir etiquetas"), it goes into the ítem's fórmula de la
-- prescripción in the libro recetario asiento -- hashed there (formula_texto), so it is fixed from then on.
--
-- 1. preparacion.excipiente_texto: free text, NULL = not informed.
-- 2. Column grant: fsj_app may update ONLY this column (plus the existing ones).
-- 3. INV-P08: it can change only while the preparación is INICIADA (CONFIRMADA / DESCARTADA freeze it).

-- ============================================================================
-- 1. Column
-- ============================================================================
ALTER TABLE fsj.preparacion ADD COLUMN IF NOT EXISTS excipiente_texto varchar(120);

ALTER TABLE fsj.preparacion
  ADD CONSTRAINT preparacion_excipiente_texto_check CHECK (excipiente_texto IS NULL OR length(btrim(excipiente_texto)) > 0);

COMMENT ON COLUMN fsj.preparacion.excipiente_texto IS
  '0083. Excipiente actually used, typed in the toma workspace after "Marcar como preparada" (optional). Goes into the ítem''s fórmula in the libro recetario asiento at confirmation. Changes only while INICIADA (INV-P08).';

-- ============================================================================
-- 2. Grant
-- ============================================================================
GRANT UPDATE (excipiente_texto) ON fsj.preparacion TO fsj_app;

-- ============================================================================
-- 3. INV-P08
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.preparacion_validar_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.excipiente_texto IS DISTINCT FROM OLD.excipiente_texto AND OLD.estado <> 'INICIADA' THEN
    RAISE EXCEPTION 'INV-P08: excipiente_texto can only change while the preparacion is INICIADA (is %)', OLD.estado
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_excipiente() IS
  '0083, INV-P08: preparacion.excipiente_texto changes only while INICIADA; the confirmation copies it into the hashed asiento fórmula.';

CREATE TRIGGER trg_preparacion_validar_excipiente
  BEFORE UPDATE OF excipiente_texto ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.preparacion_validar_excipiente();
