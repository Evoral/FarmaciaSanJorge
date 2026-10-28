-- 0109_chat_ayuda
--
-- Adds the internal help chat support (openspec/changes/chat-ayuda/):
--   1. Permiso: 'ayuda.consultar' with category 'consulta' in fsj.permiso.
--      ADMINISTRADOR gets it automatically through PERMISOS_DE_ADMINISTRADOR;
--      other roles obtain it via the role editor. No role rows are inserted here.
--   2. Table fsj.consulta_ayuda: audit log of questions asked in the help chat.
--      Columns: id, tenant_id, usuario_id, conversacion_id, pregunta, respuesta,
--      entrada_id, resultado, util, created_at.
--      - CHECK on char_length(pregunta) BETWEEN 1 AND 300.
--      - CHECK on resultado IN ('respondida', 'fuera_de_opciones', 'error').
--   3. Index: (tenant_id, created_at) for platform owner log reviews.
--   4. Tenant setup: fsj.setup_tenant_table('fsj.consulta_ayuda') applies RLS
--      (enabled + forced), tenant_isolation policy (INV-T01), and the
--      forbid_tenant_id_change trigger (INV-T03).
--   5. Grants: fsj_app receives table-level SELECT and INSERT through default
--      privileges (ALTER DEFAULT PRIVILEGES in migration 0000). Default privileges
--      in schema fsj only grant SELECT and INSERT (never UPDATE, DELETE, or
--      TRUNCATE). We grant column-level UPDATE on (util) only so users can rate
--      their own query responses (CA14). No DELETE or TRUNCATE is granted to fsj_app.
--   6. No immutability triggers: deliberately no forbid_update_delete,
--      forbid_delete, or forbid_truncate triggers are added. The platform owner
--      must be able to delete rows by hand for retention management (proposal
--      decision 10).
--
-- Numbering: 0108 (20261027120000_0108_postgrest_schema_vacio) was the highest.
--
-- *** APPLY 0109 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0109_chat_ayuda.down.sql (as a NEW forward
-- migration); see docs/rollbacks/chat-ayuda.md.

-- ============================================================================
-- 1. Permiso
-- ============================================================================
INSERT INTO fsj.permiso (codigo, categoria, descripcion) VALUES
  ('ayuda.consultar', 'consulta', 'Usar el chat de ayuda')
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================================
-- 2. fsj.consulta_ayuda
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.consulta_ayuda (
  id               uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES fsj.tenant (id),
  usuario_id       uuid        NOT NULL,
  conversacion_id  uuid        NOT NULL,
  pregunta         text        NOT NULL,
  respuesta        text,
  entrada_id       text,
  resultado        text        NOT NULL,
  util             boolean,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT consulta_ayuda_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT consulta_ayuda_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT consulta_ayuda_pregunta_check CHECK (char_length(pregunta) BETWEEN 1 AND 300),
  CONSTRAINT consulta_ayuda_resultado_check CHECK (resultado IN ('respondida', 'fuera_de_opciones', 'error'))
);

COMMENT ON TABLE fsj.consulta_ayuda IS
  '0109 (openspec/changes/chat-ayuda/design.md). Help chat interaction log. Tenant-scoped; platform owner reviews via SQL. Append-only for fsj_app except for rating update on util.';

-- ============================================================================
-- 3. Index
-- ============================================================================
CREATE INDEX IF NOT EXISTS consulta_ayuda_tenant_created_at_idx
  ON fsj.consulta_ayuda (tenant_id, created_at);

-- ============================================================================
-- 4. Tenant isolation setup
-- ============================================================================
SELECT fsj.setup_tenant_table('fsj.consulta_ayuda');

-- ============================================================================
-- 5. Grants
-- ============================================================================
-- Table-level SELECT and INSERT are granted to fsj_app via ALTER DEFAULT PRIVILEGES (0000).
-- Column-level UPDATE is granted only for `util` (rating answers).
GRANT UPDATE (util) ON fsj.consulta_ayuda TO fsj_app;
