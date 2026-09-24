-- 0040_entrega_regularizacion
--
-- FASE 11 (M14), points 11.1-11.3. DP-34 RESUELTA (user decision,
-- 2026-09-24): RETIRO_PRESENCIAL / ENVIO modalities, "firma recibida" =
-- the patient's signed constancia the courier brings back together with
-- the receta's physical original. DP-15 RESUELTA: new per-tenant parameter
-- `plazo_regularizacion_dias` (default 7) drives the /regularizacion
-- overdue alert.
--
-- Two NEW invariants (next free INV-ENT-* codes after INV-ENT-001,
-- migration 0016):
--   INV-ENT-002 [BD]: receta.estado can only become ENTREGADA when an
--     entrega row exists for it AND (modalidad = RETIRO_PRESENCIAL OR
--     entrega.firma_recibida = true). Defense in depth on top of the
--     app-level command sequencing (modules/entregas/application/*).
--   INV-ENT-003 [BD]: defense in depth for the ENVIO "no standalone 6.4
--     while ENVIADA_PEND_FIRMA" rule (the primary enforcement is app-level,
--     modules/recetas/application/registrar-recepcion-fisica.ts). Blocks a
--     bare `UPDATE fsj.receta SET receta_fisica_recibida = true` while the
--     receta is ENVIADA_PEND_FIRMA UNLESS the SAME statement also moves
--     estado away from ENVIADA_PEND_FIRMA (the atomic "confirmar firma"
--     path, modules/entregas/application/confirmar-firma-recibida.ts,
--     updates receta_fisica_recibida and estado in ONE UPDATE).
--
-- Transaction order this migration is designed around (both triggers are
-- plain, non-deferred BEFORE UPDATE triggers -- no DEFERRABLE constraint
-- trigger needed, because the app always writes fsj.entrega BEFORE the
-- receta row in the same transaction):
--   RETIRO_PRESENCIAL (from PREPARADA or LISTA_PARA_RETIRAR): INSERT
--     fsj.entrega (modalidad = RETIRO_PRESENCIAL) -> [UPDATE receta SET
--     estado = 'LISTA_PARA_RETIRAR', only if starting at PREPARADA] ->
--     UPDATE receta SET estado = 'ENTREGADA'.
--   ENVIO: INSERT fsj.entrega (modalidad = ENVIO, firma_recibida = false)
--     -> [UPDATE receta SET estado = 'LISTA_PARA_RETIRAR', if needed] ->
--     UPDATE receta SET estado = 'ENVIADA_PEND_FIRMA'.
--   Confirmar firma recibida: UPDATE fsj.entrega SET firma_recibida = true,
--     firma_recibida_en = now() -> UPDATE fsj.receta SET
--     receta_fisica_recibida = true (+ _en/_por_id, only if not already
--     set), estado = 'ENTREGADA' -- ONE statement, so INV-ENT-003 sees
--     estado changing and lets it through.

-- ============================================================================
-- DP-15 RESUELTA: plazo_regularizacion_dias (default 7), backfilled for
-- every existing tenant -- same ON CONFLICT DO NOTHING convention as
-- migration 0038's plazo_firma_dias. New tenants get it from
-- scripts/create-tenant.ts (updated alongside this migration).
-- ============================================================================
INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'plazo_regularizacion_dias',
  'NUMERO',
  '7',
  'Plazo, en dias corridos desde el asiento mas antiguo sin receta fisica recibida, a partir del cual una receta se muestra vencida en /regularizacion -- DP-15, FASE 11 punto 11.3'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

-- ============================================================================
-- INV-ENT-002 [BD]: no ENTREGADA without a matching entrega row.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_entrega_para_entregada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado = 'ENTREGADA' THEN
    SELECT EXISTS (
      SELECT 1 FROM fsj.entrega e
      WHERE e.tenant_id = NEW.tenant_id AND e.receta_id = NEW.id
        AND (e.modalidad = 'RETIRO_PRESENCIAL' OR e.firma_recibida)
    ) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'INV-ENT-002: receta % cannot become ENTREGADA without a matching entrega row (RETIRO_PRESENCIAL, or ENVIO with firma_recibida)', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_entrega_para_entregada() IS
  'INV-ENT-002 (migration 0040, FASE 11/DP-34): defense in depth on top of modules/entregas/application -- ENTREGADA requires an entrega row (RETIRO_PRESENCIAL, or ENVIO already firma_recibida). Relies on the app always INSERTing/UPDATEing fsj.entrega BEFORE this receta UPDATE, in the same transaction.';

CREATE TRIGGER trg_receta_validar_entrega_para_entregada
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_entrega_para_entregada();

-- ============================================================================
-- INV-ENT-003 [BD]: defense in depth -- block a STANDALONE
-- registrar-recepcion-fisica (6.4) while ENVIADA_PEND_FIRMA. The atomic
-- "confirmar firma recibida" path changes estado in the SAME UPDATE
-- statement, so it is NOT affected (NEW.estado IS DISTINCT FROM OLD.estado
-- lets it through). The primary enforcement is app-level (clear Spanish
-- message, modules/recetas/application/registrar-recepcion-fisica.ts) --
-- this is a cheap backstop, not the main UX.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_fisica_no_standalone_en_envio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.estado = 'ENVIADA_PEND_FIRMA'
     AND NEW.estado = OLD.estado
     AND NEW.receta_fisica_recibida = true
     AND OLD.receta_fisica_recibida = false
  THEN
    RAISE EXCEPTION 'INV-ENT-003: receta % is ENVIADA_PEND_FIRMA -- use "confirmar firma recibida", not a standalone recepcion fisica', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_fisica_no_standalone_en_envio() IS
  'INV-ENT-003 (migration 0040, FASE 11/DP-34 decision 1): backstop for the app-level rule in modules/recetas/application/registrar-recepcion-fisica.ts. A statement that changes estado in the SAME UPDATE (the atomic confirmar-firma path) is unaffected.';

CREATE TRIGGER trg_receta_validar_fisica_no_standalone_en_envio
  BEFORE UPDATE OF receta_fisica_recibida ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_fisica_no_standalone_en_envio();
