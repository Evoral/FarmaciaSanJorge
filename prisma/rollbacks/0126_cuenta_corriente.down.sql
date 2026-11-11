-- Rollback of 0126_cuenta_corriente (apply as a NEW forward migration). Revert the stage-4 code FIRST
-- (docs/rollbacks/plataforma-superadmin.md).
-- *** DROPS EVERY CARGO AND PAGO. *** Export them first:
--   COPY (SELECT * FROM fsj.plataforma_cargo) TO STDOUT WITH CSV HEADER;  -- and the same for fsj.plataforma_pago
-- The platform audit (0124) keeps the CARGO_* / PAGO_* rows.

-- 0125's list again, with saldo 0.
CREATE OR REPLACE FUNCTION fsj.plataforma_listar_tenants(p_token_hash text, p_busqueda text, p_limit integer, p_offset integer)
RETURNS TABLE (
  id               uuid,
  razon_social     text,
  nombre_fantasia  text,
  cuit             text,
  estado           fsj.estado_tenant,
  fecha_baja       timestamptz,
  saldo            numeric,
  total            bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor    uuid := fsj.plataforma_actor(p_token_hash);
  v_busqueda text := nullif(btrim(coalesce(p_busqueda, '')), '');
  v_patron   text := '%' || replace(replace(replace(v_busqueda, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digitos  text := nullif(regexp_replace(coalesce(v_busqueda, ''), '[^0-9]', '', 'g'), '');
BEGIN
  RETURN QUERY
  SELECT t.id, t.razon_social, t.nombre_fantasia, t.cuit, t.estado, t.fecha_baja, 0::numeric, count(*) OVER ()
  FROM fsj.tenant t
  WHERE v_busqueda IS NULL
     OR t.razon_social ILIKE v_patron
     OR t.nombre_fantasia ILIKE v_patron
     OR (v_digitos IS NOT NULL AND regexp_replace(t.cuit, '[^0-9]', '', 'g') LIKE '%' || v_digitos || '%')
  ORDER BY t.razon_social, t.id
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

DROP FUNCTION IF EXISTS fsj.plataforma_saldo(text, uuid);
DROP FUNCTION IF EXISTS fsj.plataforma_cuenta_corriente(text, uuid);
DROP FUNCTION IF EXISTS fsj.plataforma_anular_movimiento(text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_registrar_pago(text, uuid, date, numeric, fsj.medio_pago_plataforma, text, uuid, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_registrar_cargo(text, uuid, date, numeric, text, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_exigir_tenant(uuid);
DROP FUNCTION IF EXISTS fsj.plataforma_saldo_tenant(uuid);

DROP TABLE IF EXISTS fsj.plataforma_pago;
DROP TABLE IF EXISTS fsj.plataforma_cargo;

DROP FUNCTION IF EXISTS fsj.plataforma_movimiento_solo_anular();
DROP TYPE IF EXISTS fsj.medio_pago_plataforma;
