-- 0004_credenciales_sesiones
--
-- FASE 1, point 1.4: activation credentials and sessions (M02). Depends on
-- 0002 (fsj.usuario). Policy values (credential TTL, session timeouts) are
-- centralized in shared/auth/policy.ts (TS constants, DP-20-pending) rather
-- than in `parametro` -- see that file's header for why.

DO $do$ BEGIN
  CREATE TYPE fsj.motivo_emision_credencial AS ENUM ('ALTA', 'RESTABLECIMIENTO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- credencial_activacion (M02) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.credencial_activacion (
  id                uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  usuario_id        uuid NOT NULL,
  token_hash        text NOT NULL,
  emitida_por_id    uuid NOT NULL,
  emitida_en        timestamptz NOT NULL DEFAULT now(),
  vence_en          timestamptz NOT NULL,
  usada_en          timestamptz,
  revocada_en       timestamptz,
  motivo_emision    fsj.motivo_emision_credencial NOT NULL,
  CONSTRAINT credencial_activacion_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT credencial_activacion_token_hash_key UNIQUE (token_hash),
  CONSTRAINT credencial_activacion_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT credencial_activacion_emitida_por_fkey FOREIGN KEY (tenant_id, emitida_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT credencial_activacion_vence_check CHECK (vence_en > emitida_en),
  -- A credential can't be both consumed and revoked at once.
  CONSTRAINT credencial_activacion_usada_xor_revocada CHECK (usada_en IS NULL OR revocada_en IS NULL)
);

COMMENT ON TABLE fsj.credencial_activacion IS
  'M02: one-use activation credential. token_hash stores the hash only (never the raw token -- INV-AU-001). The application MUST consume it with an atomic `UPDATE ... SET usada_en = now() WHERE usada_en IS NULL AND revocada_en IS NULL AND vence_en > now() RETURNING ...` (INV-AU-002) -- FASE 2. The partial unique index below additionally guarantees at most one ACTIVE credential per user at the DB level.';

SELECT fsj.setup_tenant_table('fsj.credencial_activacion');

-- At most one non-used, non-revoked credential per user (M02 entity spec).
CREATE UNIQUE INDEX IF NOT EXISTS uq_credencial_activacion_activa
  ON fsj.credencial_activacion (tenant_id, usuario_id)
  WHERE usada_en IS NULL AND revocada_en IS NULL;

GRANT UPDATE (usada_en, revocada_en) ON fsj.credencial_activacion TO fsj_app;

-- INV-AU-002 (DB half): once usada_en/revocada_en is set, it cannot be
-- changed again (no "un-consuming" or "un-revoking" a credential).
CREATE OR REPLACE FUNCTION fsj.credencial_activacion_forbid_reuse_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.usada_en IS NOT NULL AND NEW.usada_en IS DISTINCT FROM OLD.usada_en THEN
    RAISE EXCEPTION 'INV-AU-002: credencial_activacion.usada_en cannot change once set'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.revocada_en IS NOT NULL AND NEW.revocada_en IS DISTINCT FROM OLD.revocada_en THEN
    RAISE EXCEPTION 'INV-AU-002: credencial_activacion.revocada_en cannot change once set'
      USING ERRCODE = 'P0001';
  END IF;
  -- INV-AU-002 (expiry half): an expired credential can never be consumed,
  -- whatever WHERE clause the caller used. Revoking one stays legal.
  IF NEW.usada_en IS NOT NULL AND OLD.usada_en IS NULL AND NEW.usada_en > NEW.vence_en THEN
    RAISE EXCEPTION 'INV-AU-002: credencial_activacion cannot be used after vence_en'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credencial_activacion_forbid_reuse_update
  BEFORE UPDATE ON fsj.credencial_activacion
  FOR EACH ROW EXECUTE FUNCTION fsj.credencial_activacion_forbid_reuse_update();

-- ============================================================================
-- sesion (M02) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.sesion (
  id                 uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  usuario_id         uuid NOT NULL,
  token_hash         text NOT NULL,
  creada_en          timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_en      timestamptz NOT NULL DEFAULT now(),
  expira_en          timestamptz NOT NULL,
  revocada_en        timestamptz,
  ip                 inet,
  user_agent         text,
  reautenticada_en   timestamptz,
  CONSTRAINT sesion_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT sesion_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sesion_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT sesion_expira_check CHECK (expira_en > creada_en)
);

COMMENT ON TABLE fsj.sesion IS
  'M02: opaque server-side session. token_hash stores the hash only (never the raw token). Sessions are revoked (revocada_en), never deleted, to preserve an audit trail. expira_en is fixed at creation time -- see shared/auth/policy.ts for the absolute/idle timeout values that compute it (DP-20-pending).';

SELECT fsj.setup_tenant_table('fsj.sesion');

GRANT UPDATE (ultimo_uso_en, revocada_en, reautenticada_en) ON fsj.sesion TO fsj_app;
