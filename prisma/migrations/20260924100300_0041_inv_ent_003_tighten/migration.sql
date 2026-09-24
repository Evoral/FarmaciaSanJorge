-- ============================================================================
-- 0041 -- tighten INV-ENT-003 (migration 0040).
--
-- The 0040 version only rejected receta_fisica_recibida false->true when
-- estado stayed ENVIADA_PEND_FIRMA, so ANY combined UPDATE that also changed
-- estado (not just the atomic confirmar-firma path to ENTREGADA) slipped
-- through. While a receta is ENVIADA_PEND_FIRMA, the physical receta may only
-- be registered in the same statement that moves it to ENTREGADA.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_fisica_no_standalone_en_envio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.estado = 'ENVIADA_PEND_FIRMA'
     AND NEW.estado <> 'ENTREGADA'
     AND NEW.receta_fisica_recibida = true
     AND OLD.receta_fisica_recibida = false
  THEN
    RAISE EXCEPTION 'INV-ENT-003: receta % is ENVIADA_PEND_FIRMA -- the receta fisica can only be registered by "confirmar firma recibida"', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_fisica_no_standalone_en_envio() IS
  'INV-ENT-003 (migrations 0040/0041, FASE 11/DP-34 decision 1): while ENVIADA_PEND_FIRMA, receta_fisica_recibida may only go false->true in the same UPDATE that sets estado = ENTREGADA (the atomic confirmar-firma path). Backstop for modules/recetas/application/registrar-recepcion-fisica.ts.';
