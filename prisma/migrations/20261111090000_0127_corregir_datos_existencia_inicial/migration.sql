-- 0127_corregir_datos_existencia_inicial
--
-- docs/specs/existencia-inicial.md, change openspec/changes/planilla-existencia-inicial/ (R18).
-- Allows correcting lote, vencimiento and proveedor of an UNUSED partida de existencia inicial:
--   1. fsj.partida_corregir_datos_inicial(p_tenant_id, p_partida_id, p_lote, p_fecha_vencimiento, p_proveedor_id):
--      SECURITY DEFINER function with fixed search_path. Validates tenant, locks the partida FOR UPDATE,
--      ensures origen EXISTENCIA_INICIAL, relevamiento abierto, and unused status (no non-initial movements,
--      no active reserva, no reanálisis, fecha_apertura IS NULL). Updates lote, proveedor_id, fecha_vencimiento
--      and fecha_vencimiento_vigente under transaction-local flag fsj.correccion_inicial = 'on'.
--      Returns old values for audit.
--   2. fsj.partida_validar_update: relaxed only for INV-S23 when fsj.correccion_inicial = 'on'.
--   3. No EXECUTE grant to PUBLIC (REVOKE ALL ... FROM PUBLIC). Executable by fsj_app via default privileges
--      configured in migration 0101.
--
-- Rollback: prisma/rollbacks/0127_corregir_datos_existencia_inicial.down.sql (as a NEW forward migration),
-- docs/rollbacks/planilla-existencia-inicial.md.

-- ============================================================================
-- 1. fsj.partida_corregir_datos_inicial
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.partida_corregir_datos_inicial(
  p_tenant_id uuid,
  p_partida_id uuid,
  p_lote text,
  p_fecha_vencimiento date,
  p_proveedor_id uuid
)
RETURNS TABLE (
  lote_anterior text,
  fecha_vencimiento_anterior date,
  proveedor_id_anterior uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_partida    fsj.partida%ROWTYPE;
  v_clase      fsj.clase_droga;
  v_lote_nuevo text;
BEGIN
  IF p_tenant_id IS DISTINCT FROM fsj.current_tenant_id() THEN
    RAISE EXCEPTION 'INV-C22: p_tenant_id (%) does not match current tenant (%)',
      p_tenant_id, fsj.current_tenant_id()
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_partida
  FROM fsj.partida p
  WHERE p.tenant_id = p_tenant_id AND p.id = p_partida_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partida % not found in tenant %', p_partida_id, p_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_partida.origen <> 'EXISTENCIA_INICIAL' THEN
    RAISE EXCEPTION 'cannot correct initial data: partida % has origen % (expected EXISTENCIA_INICIAL)',
      p_partida_id, v_partida.origen
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT fsj.relevamiento_inicial_abierto(p_tenant_id) THEN
    RAISE EXCEPTION 'INV-S24: cannot correct initial data -- relevamiento inicial of tenant % is closed',
      p_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  -- R18 unused: fecha_apertura IS NULL
  IF v_partida.fecha_apertura IS NOT NULL THEN
    RAISE EXCEPTION 'cannot correct initial data: partida % has already been opened (fecha_apertura %)',
      p_partida_id, v_partida.fecha_apertura
      USING ERRCODE = 'P0001';
  END IF;

  -- R18 unused: no movimiento_stock other than initial movements
  IF EXISTS (
    SELECT 1 FROM fsj.movimiento_stock m
    WHERE m.tenant_id = p_tenant_id
      AND m.partida_id = p_partida_id
      AND m.tipo::text NOT IN ('INGRESO_INICIAL', 'CORRECCION_INICIAL_SUMA', 'CORRECCION_INICIAL_RESTA')
  ) THEN
    RAISE EXCEPTION 'cannot correct initial data: partida % has non-initial stock movements',
      p_partida_id
      USING ERRCODE = 'P0001';
  END IF;

  -- R18 unused: no active reserva
  IF EXISTS (
    SELECT 1 FROM fsj.reserva_stock rs
    JOIN fsj.preparacion prep ON prep.tenant_id = rs.tenant_id AND prep.id = rs.preparacion_id
    WHERE rs.tenant_id = p_tenant_id
      AND rs.partida_id = p_partida_id
      AND prep.estado = 'INICIADA'
  ) THEN
    RAISE EXCEPTION 'cannot correct initial data: partida % has active reservations in preparaciones',
      p_partida_id
      USING ERRCODE = 'P0001';
  END IF;

  -- R18 unused: no reanálisis
  IF EXISTS (
    SELECT 1 FROM fsj.reanalisis_partida rp
    WHERE rp.tenant_id = p_tenant_id
      AND rp.partida_id = p_partida_id
  ) THEN
    RAISE EXCEPTION 'cannot correct initial data: partida % has reanalisis records',
      p_partida_id
      USING ERRCODE = 'P0001';
  END IF;

  v_lote_nuevo := btrim(p_lote);
  IF v_lote_nuevo IS NULL OR v_lote_nuevo = '' THEN
    RAISE EXCEPTION 'cannot correct initial data: lote cannot be empty for partida %',
      p_partida_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Vencimiento required for DROGA (INV-S21)
  SELECT clase INTO v_clase FROM fsj.droga WHERE tenant_id = p_tenant_id AND id = v_partida.droga_id;
  IF p_fecha_vencimiento IS NULL AND v_clase = 'DROGA' THEN
    RAISE EXCEPTION 'INV-S21: a partida of a droga (clase DROGA) requires fecha_vencimiento'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('fsj.correccion_inicial', 'on', true);

  UPDATE fsj.partida
  SET lote = v_lote_nuevo,
      proveedor_id = p_proveedor_id,
      fecha_vencimiento = p_fecha_vencimiento,
      fecha_vencimiento_vigente = p_fecha_vencimiento
  WHERE id = p_partida_id AND tenant_id = p_tenant_id;

  PERFORM set_config('fsj.correccion_inicial', 'off', true);

  lote_anterior := v_partida.lote;
  fecha_vencimiento_anterior := v_partida.fecha_vencimiento;
  proveedor_id_anterior := v_partida.proveedor_id;
  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION fsj.partida_corregir_datos_inicial(uuid, uuid, text, date, uuid) FROM PUBLIC;

COMMENT ON FUNCTION fsj.partida_corregir_datos_inicial(uuid, uuid, text, date, uuid) IS
  '0127 (openspec/specs/existencia-inicial/spec.md R18). Corrects lote, fecha_vencimiento, fecha_vencimiento_vigente and proveedor_id on an unused partida de existencia inicial while the relevamiento is open.';

-- ============================================================================
-- 2. fsj.partida_validar_update (relaxed only for INV-S23 via fsj.correccion_inicial)
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.partida_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cantidad_disponible IS DISTINCT FROM OLD.cantidad_disponible
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S01: partida.cantidad_disponible can only be changed by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.cantidad_inicial IS DISTINCT FROM OLD.cantidad_inicial THEN
    IF coalesce(current_setting('fsj.mov', true), '') <> 'on' OR OLD.origen <> 'EXISTENCIA_INICIAL' THEN
      RAISE EXCEPTION 'INV-S01: partida.cantidad_inicial can only be changed by a movimiento_stock on an EXISTENCIA_INICIAL partida'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- INV-S17: once set, fecha_apertura never changes again (not even via
  -- the movimiento trigger).
  IF OLD.fecha_apertura IS NOT NULL AND NEW.fecha_apertura IS DISTINCT FROM OLD.fecha_apertura THEN
    RAISE EXCEPTION 'INV-S17: partida.fecha_apertura cannot change once set'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S16: the NULL -> value transition itself is also trigger-only.
  IF OLD.fecha_apertura IS NULL AND NEW.fecha_apertura IS NOT NULL
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S16: partida.fecha_apertura can only be set by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S23 (0074, 0127): the original expiry is never rewritten; the vigente one
  -- only moves through a reanálisis. Both admit corrección inicial when fsj.correccion_inicial = 'on'.
  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento
     AND coalesce(current_setting('fsj.correccion_inicial', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento cannot change (a reanálisis is recorded in fsj.reanalisis_partida)'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.fecha_vencimiento_vigente IS DISTINCT FROM OLD.fecha_vencimiento_vigente
     AND coalesce(current_setting('fsj.reanalisis', true), '') <> 'on'
     AND coalesce(current_setting('fsj.correccion_inicial', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento_vigente can only be changed by a reanalisis_partida insert'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.partida_validar_update() IS
  'INV-S01/S04, INV-S16/S17 (0008), INV-S23 (0074, 0127) and 0124: cantidad_disponible / fecha_apertura only through fsj.movimiento_stock_aplicar(), cantidad_inicial only for EXISTENCIA_INICIAL via movimiento_stock, fecha_vencimiento and fecha_vencimiento_vigente admit correccion inicial via fsj.partida_corregir_datos_inicial(), fecha_vencimiento_vigente also via fsj.reanalisis_partida_aplicar().';
