-- 0003_registro_auditoria
--
-- FASE 1, point 1.3: the immutable audit log (M01). Depends on 0002
-- (fsj.usuario, for the usuario_id / autorizado_por_id composite FKs).

DO $do$ BEGIN
  CREATE TYPE fsj.tipo_accion AS ENUM (
  'CREAR', 'MODIFICAR', 'BAJA', 'REACTIVAR', 'ANULAR', 'AUTORIZAR', 'FIRMAR',
  'CONFIRMAR', 'DESCARTAR', 'CAMBIAR_ESTADO', 'ASIGNAR_ROL', 'QUITAR_ROL',
  'SUSPENDER', 'RESTABLECER_CREDENCIAL', 'ACTIVAR_CUENTA', 'LOGIN_FALLIDO_BLOQUEO',
  'CORREGIR_FOLIO', 'INUTILIZAR_FOJAS', 'DESTRUIR', 'IMPRIMIR_CIERRE'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS fsj.registro_auditoria (
  id                  uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  -- INV-A03 [BD]: usuario_id NOT NULL. Automated processes use the
  -- per-tenant SISTEMA technical user (usuario.es_tecnico = true), never
  -- NULL -- see plan §9 M01.
  usuario_id          uuid NOT NULL,
  entidad             text NOT NULL,
  entidad_id          uuid NOT NULL,
  accion              fsj.tipo_accion NOT NULL,
  valor_anterior      jsonb,
  valor_nuevo         jsonb,
  motivo              text,
  autorizado_por_id   uuid,
  contexto            jsonb,
  ip                  inet,
  ocurrido_en         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registro_auditoria_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT registro_auditoria_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT registro_auditoria_autorizado_por_fkey FOREIGN KEY (tenant_id, autorizado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

COMMENT ON TABLE fsj.registro_auditoria IS
  'M01: immutable record of legally/economically/configuration-relevant operations (INV-A01, [APP] -- audit.record() is called from within the same transaction as the operation, FASE 2+). Never records reads/listings/previews (plan §9 M01, CONFIRMADO). motivo/autorizado_por_id/contexto are a documented deviation from the original diagram (plan §9 M01, marked [PROPUESTA]) -- the brief explicitly requires them.';
COMMENT ON COLUMN fsj.registro_auditoria.valor_anterior IS 'Never store password_hash, token_hash, or any credential/secret here (plan §9 M01 "NO HACER").';
COMMENT ON COLUMN fsj.registro_auditoria.valor_nuevo IS 'Never store password_hash, token_hash, or any credential/secret here (plan §9 M01 "NO HACER").';

SELECT fsj.setup_tenant_table('fsj.registro_auditoria');

CREATE INDEX IF NOT EXISTS idx_registro_auditoria_entidad
  ON fsj.registro_auditoria (tenant_id, entidad, entidad_id, ocurrido_en);
CREATE INDEX IF NOT EXISTS idx_registro_auditoria_usuario
  ON fsj.registro_auditoria (tenant_id, usuario_id, ocurrido_en);
CREATE INDEX IF NOT EXISTS idx_registro_auditoria_accion
  ON fsj.registro_auditoria (tenant_id, accion, ocurrido_en);

-- ============================================================================
-- INV-A02: immutable, no purge. Full immutability -- BOTH trigger AND no
-- UPDATE/DELETE/TRUNCATE grants (ALTER DEFAULT PRIVILEGES, Phase 0, only
-- ever grants SELECT/INSERT by default, so there is nothing to revoke here
-- -- the REVOKE below is defense-in-depth / documents the intent
-- explicitly, in case a future migration ever changes the default).
-- ============================================================================
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.registro_auditoria FROM fsj_app;

CREATE TRIGGER trg_registro_auditoria_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.registro_auditoria
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();
