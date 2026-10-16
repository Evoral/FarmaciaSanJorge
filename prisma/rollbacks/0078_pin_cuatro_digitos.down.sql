-- Rollback of 0078_pin_cuatro_digitos. Apply as a NEW forward migration,
-- together with the code that sets AUTH_POLICY.pinLength back to 6
-- (docs/rollbacks/pin-cuatro-digitos.md).
--
-- The PINs cleared by 0078 CANNOT be restored (only their hashes existed).
-- Going back to 6 digits makes every 4-digit PIN set since then unusable in
-- the same way, so they are cleared too: each usuario sets a new one from
-- /cuenta. The audit rows written by 0078 stay (registro_auditoria is
-- immutable).

INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, motivo)
SELECT u.tenant_id, s.id, 'usuario', u.id, 'MODIFICAR',
       'PIN eliminado por cambio de política: el PIN vuelve a ser de 6 dígitos (reversión de la migración 0078). El usuario configura uno nuevo desde «Mi cuenta».'
FROM fsj.usuario u
JOIN LATERAL (
  SELECT t.id
  FROM fsj.usuario t
  WHERE t.tenant_id = u.tenant_id AND t.es_tecnico
  ORDER BY t.creado_en
  LIMIT 1
) s ON true
WHERE u.pin_hash IS NOT NULL;

UPDATE fsj.usuario
SET pin_hash = NULL,
    pin_intentos_fallidos = 0,
    pin_bloqueado = false,
    pin_actualizado_en = now()
WHERE pin_hash IS NOT NULL
   OR pin_bloqueado
   OR pin_intentos_fallidos <> 0;

COMMENT ON COLUMN fsj.usuario.pin_hash IS
  'PIN re-auth feature (migration 0037): argon2id hash of the 6-digit "clave rápida", same hasher as password_hash. Never valid for login/activation/password-change/credential-reset/DT co-firma -- own step-up re-auth, and identifying the empleado on a cuenta de sector (migration 0077).';
