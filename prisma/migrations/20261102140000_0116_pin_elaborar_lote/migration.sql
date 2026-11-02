-- 0116 -- "Elaborar lote" asks the empleado's PIN by default in a NEW farmacia (user decision 2026-11-02).
--
-- fsj.seed_acciones_con_pin (latest body: 0077) adds 'stock.lote.elaborar' (permiso of 0111) to the default set, like
-- the other laboratorio / stock acts. Mirrors PERMISOS_CON_PIN_POR_DEFECTO (modules/auth/domain/permisos.ts).
-- Existing farmacias are NOT changed: their administrador switches it on in "Acciones con PIN" (re-seeding would also
-- switch back on what they switched off). CREATE OR REPLACE keeps the function's ACL (EXECUTE revoked from PUBLIC, 0077).
--
-- Rollback: prisma/rollbacks/0116_pin_elaborar_lote.down.sql (as a NEW forward migration).

CREATE OR REPLACE FUNCTION fsj.seed_acciones_con_pin(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_codigos text[] := ARRAY[
    'drogas.crear', 'drogas.editar', 'drogas.baja', 'drogas.reactivar',
    'stock.partida.ingresar', 'stock.ajuste.registrar', 'stock.lote.elaborar',
    'fichas.generar',
    'preparaciones.iniciar', 'preparaciones.descartar', 'preparaciones.confirmar',
    'etiquetas.generar'
  ];
  v_desconocidos text;
BEGIN
  -- A code missing from the catalog would otherwise be dropped silently by the JOIN below.
  SELECT string_agg(c.codigo, ', ') INTO v_desconocidos
  FROM unnest(v_codigos) AS c(codigo)
  WHERE NOT EXISTS (SELECT 1 FROM fsj.permiso p WHERE p.codigo = c.codigo);
  IF v_desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'fsj.seed_acciones_con_pin: default set references permisos missing from fsj.permiso: %', v_desconocidos;
  END IF;

  INSERT INTO fsj.accion_con_pin (tenant_id, permiso_id)
  SELECT p_tenant_id, p.id
  FROM fsj.permiso p
  WHERE p.codigo = ANY (v_codigos)
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION fsj.seed_acciones_con_pin(uuid) IS
  '0077: seeds THE default acciones that ask an empleado''s PIN in a cuenta de sector (laboratorio / stock / drogas). Called by migration 0077''s backfill, by trg_tenant_seed_acciones_con_pin and by scripts/create-tenant.ts. Mirrors PERMISOS_CON_PIN_POR_DEFECTO (modules/auth/domain/permisos.ts). Operator-only (EXECUTE revoked from PUBLIC): re-running it would switch back on what an administrator switched off. 0116: + stock.lote.elaborar.';
