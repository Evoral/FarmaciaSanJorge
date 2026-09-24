-- 0038_cierre_plazo_firma_dias
--
-- FASE 10, point 10.1/10.5 (M13a). DP-18 RESUELTA (user decision, 2026-09-24):
-- "en término" now means signing within `plazo_firma_dias` days of `p_fecha`
-- (a new per-tenant parameter, default 0 -- i.e. the previous hardcoded
-- "same jornada" rule keeps applying to every tenant that never edits it).
--
-- Only `fsj.cierre_diario_calcular_fuera_de_termino` changes -- it was
-- already isolated for exactly this purpose by migration 0015's header
-- ("Revisit this ONE function once DP-18 resolves"). `fsj.cierre_diario_firmar`
-- calls it unchanged, so its signature/behavior otherwise stays identical
-- (migration 0019's version, reproduced verbatim by migration 0039 below for
-- the DP-18c enum change -- not touched here).
--
-- Backfill: every EXISTING tenant gets `plazo_firma_dias = '0'` (same
-- convention as scripts/create-tenant.ts's other parametro seeds -- ON
-- CONFLICT DO NOTHING so this is safe to run against a tenant that
-- somehow already has the row). New tenants get it from
-- scripts/create-tenant.ts (updated in this task alongside this migration).

INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'plazo_firma_dias',
  'NUMERO',
  '0',
  'Plazo, en dias corridos desde la fecha de la jornada, dentro del cual la firma del cierre diario se considera en termino -- DP-18, FASE 10 punto 10.1'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

-- ============================================================================
-- fsj.cierre_diario_calcular_fuera_de_termino: DP-18 resolved. Reads the
-- tenant's `plazo_firma_dias` parameter (defaulting to 0 when the row is
-- somehow missing -- defensive, mirrors every app-level reader of
-- fsj.parametro, e.g. modules/stock/infrastructure/partida-repository.ts's
-- getDiasAlertaVencimiento). `p_fecha + plazo_firma_dias` is plain date
-- arithmetic (adds N days); STABLE, no writes.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(p_tenant_id uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fsj.jornada_actual(p_tenant_id) > (
    p_fecha + COALESCE(
      (SELECT valor::int FROM fsj.parametro WHERE tenant_id = p_tenant_id AND clave = 'plazo_firma_dias'),
      0
    )
  );
$$;

COMMENT ON FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(uuid, date) IS
  'DP-18 RESUELTA (migration 0038): fuera_de_termino iff the tenant''s CURRENT jornada is later than p_fecha + plazo_firma_dias (per-tenant parameter, fsj.parametro, default 0 when unset). Isolated here so a future change to the grace-period rule only touches this one function.';
