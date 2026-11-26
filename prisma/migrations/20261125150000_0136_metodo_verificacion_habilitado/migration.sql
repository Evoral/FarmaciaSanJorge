-- 0136_metodo_verificacion_habilitado
--
-- Which OPTIONAL operador verification methods a farmacia has switched on (openspec/changes/metodos-verificacion-operador,
-- openspec/specs/cuentas-de-sector/spec.md). fsj.metodo_verificacion_habilitado (tenant_id, metodo) is a presence set,
-- the same shape as fsj.accion_con_pin (0077): a row means "this farmacia accepts this method in the operador dialog".
--
--   * The PIN is NOT stored: it is always on, and that is code (modules/auth/domain/verificacion-identidad.ts,
--     `siempreHabilitado`). A row for it could only contradict the code, so the CHECK forbids it.
--   * `metodo` is not an enum: the app validates it against the method registry, so a new method needs no ALTER TYPE.
--   * No seed, no backfill and no fsj.crear_tenant_interno replacement: every optional method is off by default.
--     A future default-on method would need a replacement of that function (as 0125 did for the other seeds).
--   * fsj_app: SELECT/INSERT (default privileges, 0000) + DELETE. The set is replaced by delete + insert, a pair has
--     nothing to update (same as 0077). RLS ENABLE + FORCE + policy through fsj.setup_tenant_table.
--
-- Numbering: origin/master already holds 0132-0135 (tipo_magnitud_actividad .. solucion_uso_interno_externo); this
-- change was planned as 0132 and moved to 0136 when that was discovered.
--
-- Rollback: prisma/rollbacks/20261125150000_0136_metodo_verificacion_habilitado.down.sql, as a NEW forward migration,
-- AFTER deploying the code that no longer reads the table (docs/rollbacks/metodos-verificacion-operador.md).

CREATE TABLE IF NOT EXISTS fsj.metodo_verificacion_habilitado (
  tenant_id uuid NOT NULL REFERENCES fsj.tenant (id),
  metodo    text NOT NULL,
  PRIMARY KEY (tenant_id, metodo),
  CONSTRAINT metodo_verificacion_habilitado_metodo_check CHECK (metodo ~ '^[A-Z][A-Z_]{1,29}$' AND metodo <> 'PIN')
);

COMMENT ON TABLE fsj.metodo_verificacion_habilitado IS
  '0136. A row = this farmacia accepts this optional verification method (e.g. HUELLA) when an empleado identifies themselves in a cuenta de sector. The PIN is always on (code) and never stored. Only methods of modules/auth/domain/verificacion-identidad.ts that are not siempreHabilitado (validated by the app). fsj_app: SELECT/INSERT/DELETE, no UPDATE.';

SELECT fsj.setup_tenant_table('fsj.metodo_verificacion_habilitado');

GRANT DELETE ON fsj.metodo_verificacion_habilitado TO fsj_app;
REVOKE UPDATE ON fsj.metodo_verificacion_habilitado FROM fsj_app;
