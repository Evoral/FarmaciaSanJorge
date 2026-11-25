-- 0137_credencial_operador
--
-- The secret code of an OPTIONAL operador verification method, one row per (usuario, method)
-- (openspec/changes/metodos-verificacion-operador, openspec/specs/cuentas-de-sector/spec.md). Today the only method
-- stored here is HUELLA: the code a keyboard-wedge reader types, kept as an argon2id hash like the PIN (the PIN keeps
-- living in fsj.usuario.pin_hash and never moves here).
--
--   * PK (tenant_id, usuario_id, metodo): at most one credential per usuario and method, and the PK leads with
--     (tenant_id, usuario_id), so the composite FK to fsj.usuario is indexed (tests/db/catalogo-guardas.test.ts).
--   * The FK is (tenant_id, usuario_id) -> usuario (tenant_id, id): a credential can only belong to a usuario of its
--     own tenant (INV-T02).
--   * `metodo` is not an enum: the app validates it against the method registry, so a new code method needs no
--     ALTER TYPE. The CHECK only fixes the shape and keeps the PIN out (it lives in usuario.pin_hash).
--   * Uniqueness of a code per farmacia and method is NOT a DB constraint: hashes are salted, so it is checked in
--     the app against every other hash under pg_advisory_xact_lock(hashtext('fsj.credencial:' || metodo || ':' ||
--     tenant)), as the PIN does with 'fsj.pin:'.
--   * Disabling a method (0136) does not touch these rows: they are ignored while it is off and work again when it is
--     turned back on.
--   * fsj_app: SELECT/INSERT (default privileges, 0000), UPDATE only on (hash, actualizado_en) -- a re-enrolment
--     replaces the code -- and DELETE (the empleado or an Administrador removes it). RLS ENABLE + FORCE + policy
--     through fsj.setup_tenant_table.
--
-- Rollback: prisma/rollbacks/20261125160000_0137_credencial_operador.down.sql, as a NEW forward migration, AFTER
-- deploying the code that no longer reads the table (docs/rollbacks/metodos-verificacion-operador.md).

CREATE TABLE IF NOT EXISTS fsj.credencial_operador (
  tenant_id      uuid        NOT NULL,
  usuario_id     uuid        NOT NULL,
  metodo         text        NOT NULL,
  hash           text        NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, usuario_id, metodo),
  CONSTRAINT credencial_operador_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT credencial_operador_metodo_check CHECK (metodo ~ '^[A-Z][A-Z_]{1,29}$' AND metodo <> 'PIN')
);

COMMENT ON TABLE fsj.credencial_operador IS
  '0137. The argon2id hash of an empleado''s secret code for an optional verification method (e.g. HUELLA), one per (usuario, method). Never the code. The PIN is not here (fsj.usuario.pin_hash). Uniqueness per farmacia and method is checked by the app under an advisory lock. fsj_app: SELECT/INSERT, UPDATE (hash, actualizado_en), DELETE.';

SELECT fsj.setup_tenant_table('fsj.credencial_operador');

GRANT UPDATE (hash, actualizado_en) ON fsj.credencial_operador TO fsj_app;
GRANT DELETE ON fsj.credencial_operador TO fsj_app;
