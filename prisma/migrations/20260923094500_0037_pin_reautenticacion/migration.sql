-- 0037_pin_reautenticacion
--
-- User decision (2026-09-23): per-user quick re-authentication PIN ("clave
-- rápida" -- 6 numeric digits) so a pharmacist can step up (confirmar
-- preparación, etc.) without typing the full password. Adds four columns
-- to fsj.usuario, mirroring the password lockout columns already there
-- (password_hash / intentos_fallidos / bloqueado_hasta, migration 0002):
--
--   pin_hash               -- argon2id hash of the PIN, SAME hasher as
--                             password_hash (modules/auth/domain/password.ts).
--                             NEVER used for login/activation/password-change/
--                             credential-reset/DT co-firma -- only for the
--                             logged-in user's OWN step-up re-auth.
--   pin_intentos_fallidos  -- own counter, deliberately SEPARATE from
--                             intentos_fallidos: PIN brute-forcing must never
--                             lock the account itself (DoS avoidance), and
--                             password brute-forcing must never touch this.
--   pin_bloqueado          -- set once pin_intentos_fallidos reaches
--                             AUTH_POLICY.maxFailedPinAttempts (5). Cleared
--                             (together with the counter) by a successful
--                             PASSWORD re-auth -- see reautenticar.ts.
--   pin_actualizado_en     -- stamped whenever the PIN is set/changed/removed.
--
-- Column-level GRANT UPDATE follows the exact pattern migration 0002 used
-- for password_hash/intentos_fallidos/bloqueado_hasta on this same table
-- (ALTER DEFAULT PRIVILEGES only grants SELECT/INSERT by default).
--
-- CHECK constraint: a blocked PIN implies a PIN actually exists (a NULL
-- pin_hash -- no PIN configured -- can never be "blocked").

ALTER TABLE fsj.usuario
  ADD COLUMN pin_hash text,
  ADD COLUMN pin_intentos_fallidos integer NOT NULL DEFAULT 0,
  ADD COLUMN pin_bloqueado boolean NOT NULL DEFAULT false,
  ADD COLUMN pin_actualizado_en timestamptz;

ALTER TABLE fsj.usuario
  ADD CONSTRAINT usuario_pin_bloqueado_requiere_pin
  CHECK (NOT pin_bloqueado OR pin_hash IS NOT NULL);

COMMENT ON COLUMN fsj.usuario.pin_hash IS
  'PIN re-auth feature (migration 0037): argon2id hash of the 6-digit "clave rápida", same hasher as password_hash. Never valid for login/activation/password-change/credential-reset/DT co-firma -- own step-up re-auth only.';
COMMENT ON COLUMN fsj.usuario.pin_intentos_fallidos IS
  'Own failed-attempt counter, separate from intentos_fallidos (password lockout) -- see usuario_pin_bloqueado_requiere_pin.';
COMMENT ON COLUMN fsj.usuario.pin_bloqueado IS
  'Set once pin_intentos_fallidos reaches AUTH_POLICY.maxFailedPinAttempts. Cleared by a successful PASSWORD re-auth, not by a successful PIN attempt (a blocked PIN never authenticates, so it cannot self-clear).';

GRANT UPDATE (
  pin_hash, pin_intentos_fallidos, pin_bloqueado, pin_actualizado_en
) ON fsj.usuario TO fsj_app;
