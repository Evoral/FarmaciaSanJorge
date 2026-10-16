-- 0078_pin_cuatro_digitos
--
-- User decision (2026-10-13): the "clave rápida" PIN (migration 0037) goes
-- from exactly 6 digits to exactly 4 (AUTH_POLICY.pinLength,
-- shared/auth/policy.ts). The PIN is stored only as an argon2id hash, so a
-- 6-digit PIN cannot be shortened or re-validated: every existing PIN is
-- CLEARED and its owner sets a new 4-digit one from /cuenta (with their
-- password, as always). Until then they confirm with their password, and
-- cannot identify themselves on a cuenta de sector (docs/specs/cuentas-de-sector.md).
--
-- DATA ONLY -- no schema change:
--   * One registro_auditoria row per usuario whose PIN is cleared, authored
--     by the tenant's technical usuario (es_tecnico -- the actor of automatic
--     changes, as in modules/archivo's plazos job), like the row
--     `eliminarPin` writes when a usuario removes their own PIN. Never the
--     PIN or its hash.
--   * pin_hash -> NULL, counter and block reset (usuario_pin_bloqueado_requiere_pin
--     requires both together), pin_actualizado_en stamped.
--
-- Runs as the migration owner (bypasses RLS), like 0042/0054/0057/0077.
--
-- Numbering: 0077 (20261013150000_0077_cuentas_de_sector) is the highest at
-- the time of writing -- re-check before applying.
--
-- Deploy together with the code that sets pinLength = 4: older code would
-- still ask for 6 digits; newer code against uncleared PINs would leave
-- their owners with a PIN they can no longer type.
--
-- NOT reversible: the cleared hashes are gone. See
-- prisma/rollbacks/0078_pin_cuatro_digitos.down.sql.

INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, motivo)
SELECT u.tenant_id, s.id, 'usuario', u.id, 'MODIFICAR',
       'PIN eliminado por cambio de política: el PIN pasa de 6 a 4 dígitos (migración 0078). El usuario configura uno nuevo desde «Mi cuenta».'
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
  'PIN re-auth feature (migration 0037): argon2id hash of the "clave rápida" (4 digits since migration 0078, which cleared every 6-digit PIN), same hasher as password_hash. Never valid for login/activation/password-change/credential-reset/DT co-firma -- own step-up re-auth, and identifying the empleado on a cuenta de sector (migration 0077).';
