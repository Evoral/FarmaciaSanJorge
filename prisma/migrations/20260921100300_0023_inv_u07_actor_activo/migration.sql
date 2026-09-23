-- 0023_inv_u07_actor_activo
--
-- Closes a missing DB invariant: INV-U07 (plan M02) --
-- "Mientras la cuenta permanezca en PENDIENTE_ACTIVACION no puede operar
-- sobre ningun modulo ni figurar como responsable de ninguna accion
-- registrada". Only the APP half existed (requireSession() rejects
-- non-ACTIVO users, shared/usecase.ts). `grep INV-U07 prisma/migrations`
-- was empty before this file -- nothing at the DB layer stopped a direct
-- INSERT (or a future app bug) from recording a PENDIENTE_ACTIVACION,
-- SUSPENDIDO or BAJA user as the author of a stock movement, an asiento,
-- a preparacion, a cierre, etc. Also covers SUSPENDIDO/BAJA, not just
-- PENDIENTE_ACTIVACION -- the plan wording says "la cuenta" generically,
-- and INV-U04/INV-U05/INV-DT-005 (migration 0022) already established the
-- precedent that only ACTIVO is a valid acting state, full stop.
--
-- ============================================================================
-- fsj.assert_actor_activo(): ONE generic trigger function, reused by every
-- table below via TG_ARGV (the list of actor columns to check on THAT
-- table). Column values are read dynamically and safely with
-- `to_jsonb(NEW) ->> col` / `to_jsonb(OLD) ->> col` -- never dynamic SQL,
-- so there is no injection surface even though the column names come from
-- trigger arguments.
--
-- Two firing modes, selected by TG_OP (the SAME function, attached via TWO
-- different CREATE TRIGGER statements per table where needed -- see below):
--
--   INSERT: every configured column is checked unconditionally (NULL is
--   skipped -- an unset optional actor, e.g. movimiento_stock.
--   autorizado_por_id for a non-AJUSTE row, has not "acted" yet).
--
--   UPDATE: a column is checked ONLY on its NULL -> value transition
--   (OLD IS NULL AND NEW IS NOT NULL). A column that already had a value
--   is skipped -- this is what makes historical rows immune to being
--   re-validated when their author is LATER suspended or given BAJA
--   (INV-U03: usuario rows are edited in place, never deleted, so an old
--   movimiento/asiento/etc. must keep referencing whoever really recorded
--   it, unchanged, forever). Only columns that are legitimately SET LATER
--   by an UPDATE (the moment someone actually performs that action) are
--   ever attached to the UPDATE trigger -- see the per-table list below.
--
-- Self-reference bootstrap (fsj.usuario.creado_por_id = id for the
-- per-tenant SISTEMA user, scripts/create-tenant.ts: "INSERT INTO
-- fsj.usuario (..., estado, ..., creado_por_id) VALUES (..., 'ACTIVO',
-- ..., $1) -- id = $1"): a BEFORE INSERT trigger runs before the new row
-- exists in the table, so a lookup by id would find nothing even though
-- the row declares itself ACTIVO in this very statement. Special-cased
-- (scoped to fsj.usuario ONLY, via TG_TABLE_NAME -- not a generic
-- "actor = own id" shortcut, which would be a needlessly broad bypass for
-- every other table): when the actor column's value equals NEW.id on the
-- fsj.usuario table itself, NEW.estado is trusted directly instead of
-- querying the table -- it is exactly what will be persisted by this same
-- INSERT if it succeeds. fsj.usuario_rol.asignado_por_id and
-- fsj.credencial_activacion.emitida_por_id do NOT need this: by the time
-- create-tenant.ts inserts those rows, SISTEMA's own usuario row already
-- committed (same transaction, earlier statement) with estado = 'ACTIVO',
-- so a normal lookup finds it.
--
-- Ordering against MORE SPECIFIC invariants (IMPORTANT): on
-- fsj.movimiento_stock and fsj.anulacion_asiento, INV-U05 (migration 0008/
-- 0014/0022, fsj.es_dt_vigente) already rejects an AJUSTE/anulacion
-- authorized by a DT who is designated-and-vigente but not ACTIVO right
-- now, with that EXACT code -- and tests/db/partidas-movimientos-stock.
-- test.ts and tests/db/libro-recetario.test.ts assert on "INV-U05"
-- specifically (designate an ACTIVO DT, then suspend them, then attempt
-- the AJUSTE/anulacion). Postgres fires multiple BEFORE ROW triggers for
-- the same event in ALPHABETICAL order of trigger name, and stops at the
-- first one that raises -- so if this migration's trigger ran first for
-- the same row, the test would see "INV-U07: ..." instead of the
-- "INV-U05: ..." it asserts on, breaking it even though the row is
-- correctly rejected either way. Every trigger added below is therefore
-- named `trg_<table>_zz_inv_u07_<insert|update>` -- the `zz_` prefix
-- guarantees it alphabetically sorts AFTER every other BEFORE ROW trigger
-- this codebase has ever defined on these tables (none start with `z`),
-- so a row that violates BOTH a specific invariant and INV-U07 always
-- reports the specific one first. This is purely about which message
-- surfaces first when a row is invalid for more than one reason -- it
-- does not change whether the row is accepted (both triggers reject it).
-- fsj.cierre_diario is the one exception that needs no such care: rows are
-- inserted EXCLUSIVELY by fsj.cierre_diario_firmar() (SECURITY DEFINER,
-- fsj_app has no direct INSERT grant), which already runs its own inline
-- INV-U04 "usuario ACTIVO" check on the DT BEFORE the INSERT statement
-- ever executes -- so this migration's trigger on that table's INSERT can
-- never actually fire in practice; it is pure defense-in-depth for a
-- direct INSERT that bypassed the function (owner/migration role only).
--
-- ============================================================================
-- Coverage (every table/column this migration attaches INV-U07 to):
--
--   INSERT (checked on every INSERT, all configured columns):
--     fsj.usuario                       -- creado_por_id (self-ref bootstrap, see above)
--     fsj.usuario_rol                   -- asignado_por_id
--     fsj.usuario_estado_historial      -- cambiado_por_id
--     fsj.designacion_director_tecnico  -- registrado_por_id
--     fsj.movimiento_stock              -- registrado_por_id, autorizado_por_id
--     fsj.ficha_tecnica                 -- generada_por_id
--     fsj.preparacion                   -- iniciada_por_id
--     fsj.libro_rubricado               -- registrado_por_id
--     fsj.asiento_recetario             -- registrado_por_id
--     fsj.anulacion_asiento             -- autorizado_por_id, anulado_por_id
--     fsj.asiento_historico             -- digitalizado_por_id
--     fsj.asiento_contralor             -- registrado_por_id
--     fsj.receta                        -- registrada_por_id
--     fsj.credencial_activacion         -- emitida_por_id
--     fsj.sesion                        -- usuario_id
--     fsj.entrega                       -- entregada_por_id
--     fsj.lote_archivo_recetas          -- registrado_por_id
--     fsj.cierre_diario                 -- director_tecnico_id
--
--   UPDATE (checked ONLY on the column's NULL -> value transition):
--     fsj.preparacion                   -- preparada_por_id, descartada_por_id
--     fsj.etiqueta                      -- impresa_por_id
--     fsj.receta                        -- receta_fisica_recibida_por_id
--     fsj.cierre_diario                 -- impreso_por_id
--
--   Deliberately EXCLUDED (documented, not an oversight):
--
--     fsj.registro_auditoria (usuario_id, autorizado_por_id): INV-A03
--       already requires a NOT NULL, real usuario_id (no anonymous audit
--       rows). But this table's job is to record security/audit EVENTS,
--       not business actions -- and it must keep being able to do that
--       regardless of the subject account's current state. Concretely:
--       LOGIN_FALLIDO_BLOQUEO (modules/auth/application/login.ts) audits
--       the account that got locked out as its OWN author -- checked
--       against modules/auth/domain/login-policy.ts#decideLogin, that
--       specific path only runs when estado WAS already 'ACTIVO' (LOCKED
--       and INACTIVE are both checked, and returned, before
--       WRONG_PASSWORD), so today it would happen to pass INV-U07 too --
--       but the audit trail's CONTRACT should not depend on that
--       coincidence: a future audit event for a rejected login attempt by
--       a PENDIENTE_ACTIVACION/SUSPENDIDO/BAJA account (there is no such
--       event today -- decideLogin's INACTIVE branch does not audit at
--       all) must never be blocked by INV-U07, or the audit log itself
--       becomes unable to record the very account-state problem it exists
--       to document. ACTIVAR_CUENTA (modules/auth/application/
--       activar-cuenta.ts) is authored by the activating usuario_id --
--       read that file: `activarUsuario()` (estado -> ACTIVO) runs BEFORE
--       the `auditRecord()` call, in the same transaction, so usuario_id
--       is already ACTIVO by the time this row would be checked anyway;
--       excluding the table changes nothing observable there either.
--
--     Catalog tables (fsj.droga, fsj.proveedor, fsj.medico, fsj.paciente,
--       fsj.unidad_medida): checked all 4 CREATE TABLE statements
--       (migrations 0006/0007) -- NONE of them has ANY actor/creado_por_id
--       column at all (droga has nombre/unidad_base_id/densidad/
--       es_controlada/tipo_control/stock_minimo/fecha_baja/motivo_baja and
--       nothing else; same absence of an author column on the other
--       three). There is therefore nothing for INV-U07 to attach to on a
--       catalog table -- this is a PRE-EXISTING, separate gap (no catalog
--       row records who created/edited it at all, for ANY estado), out of
--       this migration's scope (adding a new creado_por_id column to a
--       catalog table is a schema change, not a trigger enforcing an
--       already-modeled invariant). Left open -- see this migration's test
--       file header for the DB test that documents this finding instead
--       of silently substituting a different table.
-- ============================================================================

CREATE OR REPLACE FUNCTION fsj.assert_actor_activo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fsj, extensions
AS $$
DECLARE
  v_col      text;
  v_new_id   text;
  v_new_val  text;
  v_old_val  text;
  v_new_estado text;
  v_estado   fsj.estado_usuario;
BEGIN
  v_new_id := to_jsonb(NEW) ->> 'id';

  FOREACH v_col IN ARRAY TG_ARGV LOOP
    v_new_val := to_jsonb(NEW) ->> v_col;

    IF TG_OP = 'UPDATE' THEN
      v_old_val := to_jsonb(OLD) ->> v_col;
      -- Only the NULL -> value transition is "performing the action" --
      -- a column that already had a value is immutable/out of scope here
      -- (see migration header). Skip it, whatever it is.
      IF v_old_val IS NOT NULL THEN
        CONTINUE;
      END IF;
    END IF;

    IF v_new_val IS NULL THEN
      CONTINUE; -- optional actor column not used on this row (yet).
    END IF;

    -- Self-reference bootstrap: fsj.usuario.creado_por_id = id, for the
    -- per-tenant SISTEMA user only (scripts/create-tenant.ts). Scoped to
    -- this table specifically -- see migration header for why.
    IF TG_TABLE_SCHEMA = 'fsj' AND TG_TABLE_NAME = 'usuario' AND v_new_val = v_new_id THEN
      v_new_estado := to_jsonb(NEW) ->> 'estado';
      IF v_new_estado IS DISTINCT FROM 'ACTIVO' THEN
        RAISE EXCEPTION 'INV-U07: %.% (self-referencing bootstrap row) is not ACTIVO (currently %)', TG_TABLE_NAME, v_col, v_new_estado
          USING ERRCODE = 'P0001';
      END IF;
      CONTINUE;
    END IF;

    SELECT u.estado INTO v_estado
    FROM fsj.usuario u
    WHERE u.tenant_id = NEW.tenant_id AND u.id = v_new_val::uuid;

    IF NOT FOUND THEN
      -- The composite FK on this column will reject this row too (it is
      -- checked AFTER row-level BEFORE triggers) -- this just gives a
      -- clearer, INV-U07-branded message when it's reached first.
      RAISE EXCEPTION 'INV-U07: %.% references usuario % which does not exist in tenant %', TG_TABLE_NAME, v_col, v_new_val, NEW.tenant_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_estado <> 'ACTIVO' THEN
      RAISE EXCEPTION 'INV-U07: %.% actor % is not ACTIVO (currently %)', TG_TABLE_NAME, v_col, v_new_val, v_estado
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.assert_actor_activo() IS
  'INV-U07 (migration 0023, plan M02): every configured actor column (TG_ARGV) must reference a fsj.usuario in the SAME tenant with estado = ACTIVO. INSERT mode checks every column unconditionally (NULL skipped); UPDATE mode checks ONLY the NULL -> value transition, so a historical row never gets re-validated when its author is later suspended/BAJA (INV-U03). Self-reference bootstrap special-cased for fsj.usuario.creado_por_id (SISTEMA, scripts/create-tenant.ts) -- see migration header for the full table/column coverage list and why registro_auditoria and the catalog tables are excluded.';

-- ============================================================================
-- fsj.usuario -- creado_por_id (self-ref bootstrap for SISTEMA)
-- ============================================================================
CREATE TRIGGER trg_usuario_zz_inv_u07_insert
  BEFORE INSERT ON fsj.usuario
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('creado_por_id');

-- ============================================================================
-- fsj.usuario_rol -- asignado_por_id
-- ============================================================================
CREATE TRIGGER trg_usuario_rol_zz_inv_u07_insert
  BEFORE INSERT ON fsj.usuario_rol
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('asignado_por_id');

-- ============================================================================
-- fsj.usuario_estado_historial -- cambiado_por_id
-- ============================================================================
CREATE TRIGGER trg_usuario_estado_historial_zz_inv_u07_insert
  BEFORE INSERT ON fsj.usuario_estado_historial
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('cambiado_por_id');

-- ============================================================================
-- fsj.designacion_director_tecnico -- registrado_por_id
-- (INV-DT-001/INV-DT-005 check usuario_id, a DIFFERENT column -- who is
-- BEING designated, not who registered the designation. No overlap.)
-- ============================================================================
CREATE TRIGGER trg_designacion_dt_zz_inv_u07_insert
  BEFORE INSERT ON fsj.designacion_director_tecnico
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- ============================================================================
-- fsj.movimiento_stock -- registrado_por_id, autorizado_por_id
-- Named zz_ so trg_movimiento_stock_validar_ajuste (INV-U05) and
-- trg_movimiento_stock_validar_vale (INV-L16) -- both BEFORE INSERT --
-- always fire first; see migration header "Ordering" note.
-- ============================================================================
CREATE TRIGGER trg_movimiento_stock_zz_inv_u07_insert
  BEFORE INSERT ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id', 'autorizado_por_id');

-- ============================================================================
-- fsj.ficha_tecnica -- generada_por_id
-- ============================================================================
CREATE TRIGGER trg_ficha_tecnica_zz_inv_u07_insert
  BEFORE INSERT ON fsj.ficha_tecnica
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('generada_por_id');

-- ============================================================================
-- fsj.preparacion -- iniciada_por_id (INSERT); preparada_por_id/
-- descartada_por_id (UPDATE, NULL -> value only -- both are set later, when
-- CONFIRMADA/DESCARTADA is reached, per the CHECK constraints pairing them
-- with confirmada_en/descartada_en).
-- ============================================================================
CREATE TRIGGER trg_preparacion_zz_inv_u07_insert
  BEFORE INSERT ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('iniciada_por_id');

CREATE TRIGGER trg_preparacion_zz_inv_u07_update
  BEFORE UPDATE ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('preparada_por_id', 'descartada_por_id');

-- ============================================================================
-- fsj.etiqueta -- impresa_por_id (UPDATE only, NULL -> value -- there is no
-- INSERT-time actor column on this table; impresa_por_id is set together
-- with impresa/impresa_en, per etiqueta_impresa_pair_check).
-- ============================================================================
CREATE TRIGGER trg_etiqueta_zz_inv_u07_update
  BEFORE UPDATE ON fsj.etiqueta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('impresa_por_id');

-- ============================================================================
-- fsj.libro_rubricado -- registrado_por_id
-- ============================================================================
CREATE TRIGGER trg_libro_rubricado_zz_inv_u07_insert
  BEFORE INSERT ON fsj.libro_rubricado
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- ============================================================================
-- fsj.asiento_recetario -- registrado_por_id
-- ============================================================================
CREATE TRIGGER trg_asiento_recetario_zz_inv_u07_insert
  BEFORE INSERT ON fsj.asiento_recetario
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- ============================================================================
-- fsj.anulacion_asiento -- autorizado_por_id, anulado_por_id
-- Named zz_ so trg_anulacion_asiento_validar (INV-U05/INV-L09/INV-L02) --
-- BEFORE INSERT -- always fires first; see migration header "Ordering".
-- ============================================================================
CREATE TRIGGER trg_anulacion_asiento_zz_inv_u07_insert
  BEFORE INSERT ON fsj.anulacion_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('autorizado_por_id', 'anulado_por_id');

-- ============================================================================
-- fsj.asiento_historico -- digitalizado_por_id
-- ============================================================================
CREATE TRIGGER trg_asiento_historico_zz_inv_u07_insert
  BEFORE INSERT ON fsj.asiento_historico
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('digitalizado_por_id');

-- ============================================================================
-- fsj.asiento_contralor -- registrado_por_id
-- ============================================================================
CREATE TRIGGER trg_asiento_contralor_zz_inv_u07_insert
  BEFORE INSERT ON fsj.asiento_contralor
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- ============================================================================
-- fsj.receta -- registrada_por_id (INSERT); receta_fisica_recibida_por_id
-- (UPDATE, NULL -> value only, paired with receta_fisica_recibida/_en per
-- receta_fisica_recibida_pair_check).
-- ============================================================================
CREATE TRIGGER trg_receta_zz_inv_u07_insert
  BEFORE INSERT ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrada_por_id');

CREATE TRIGGER trg_receta_zz_inv_u07_update
  BEFORE UPDATE ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('receta_fisica_recibida_por_id');

-- ============================================================================
-- fsj.credencial_activacion -- emitida_por_id
-- ============================================================================
CREATE TRIGGER trg_credencial_activacion_zz_inv_u07_insert
  BEFORE INSERT ON fsj.credencial_activacion
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('emitida_por_id');

-- ============================================================================
-- fsj.sesion -- usuario_id. A session can only ever be opened by login()
-- for an estado = 'ACTIVO' usuario (modules/auth/domain/login-policy.ts:
-- decideLogin returns 'OK' -- the only case insertSesionInTx runs -- only
-- when estado === 'ACTIVO', checked before password verification). This
-- adds the same guarantee at the DB layer, defense-in-depth, matching the
-- BD+APP convention every other invariant in this migration follows.
-- ============================================================================
CREATE TRIGGER trg_sesion_zz_inv_u07_insert
  BEFORE INSERT ON fsj.sesion
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('usuario_id');

-- ============================================================================
-- fsj.entrega -- entregada_por_id
-- ============================================================================
CREATE TRIGGER trg_entrega_zz_inv_u07_insert
  BEFORE INSERT ON fsj.entrega
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('entregada_por_id');

-- ============================================================================
-- fsj.lote_archivo_recetas -- registrado_por_id
-- ============================================================================
CREATE TRIGGER trg_lote_archivo_recetas_zz_inv_u07_insert
  BEFORE INSERT ON fsj.lote_archivo_recetas
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- ============================================================================
-- fsj.cierre_diario -- director_tecnico_id (INSERT -- pure defense-in-depth,
-- see migration header: fsj.cierre_diario_firmar() already enforces
-- INV-U04 "ACTIVO" inline before this INSERT ever runs); impreso_por_id
-- (UPDATE, NULL -> value only, paired with fecha_impresion per
-- cierre_diario_impresion_pair_check).
-- ============================================================================
CREATE TRIGGER trg_cierre_diario_zz_inv_u07_insert
  BEFORE INSERT ON fsj.cierre_diario
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('director_tecnico_id');

CREATE TRIGGER trg_cierre_diario_zz_inv_u07_update
  BEFORE UPDATE ON fsj.cierre_diario
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('impreso_por_id');
