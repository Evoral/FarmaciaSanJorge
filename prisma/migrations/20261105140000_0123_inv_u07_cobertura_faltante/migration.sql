-- 0123_inv_u07_cobertura_faltante
--
-- Closes the INV-U07 gap the regression guard in
-- tests/db/inv-u07-actor-activo.test.ts caught (same situation as 0032 and
-- 0081): migrations 0086, 0088, 0090, 0092, 0093 and 0110 added actor
-- columns without the actor guard, so the DB would accept a
-- PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA user as their author. The app takes
-- every one of them from the session, but INV-U07 is a [BD + APP] invariant.
--
-- Same convention as 0023/0081: the generic fsj.assert_actor_activo(), columns
-- via TG_ARGV, trigger named `trg_<table>_zz_inv_u07_*` so it fires last among
-- the BEFORE ROW triggers. INSERT mode checks every non-NULL column; UPDATE
-- mode only the NULL -> value transition, so a historical row is never
-- re-validated (INV-U03).
--
-- The borrador tables are written with INSERT ... ON CONFLICT DO UPDATE: a
-- BEFORE INSERT trigger fires for the proposed row before the conflict check,
-- so every save is checked, not only the first one.
--
-- Left out on purpose (listed in the guard test's `excluded`):
--   - entrega_anulada.entregada_por_id: a copy of the original entrega's actor,
--     who may be suspended by the time the entrega is anulada.
--   - tenant.relevamiento_inicial_cerrado_por_id: fsj.tenant has no tenant_id,
--     which the generic function reads; INV-S26 (0100) already requires a DT
--     vigente, and fsj.es_dt_vigente() requires estado = 'ACTIVO'.
--
-- Only triggers are added or replaced: existing rows are not re-validated.
-- Rollback: prisma/rollbacks/0123_inv_u07_cobertura_faltante.down.sql (as a NEW
-- forward migration).

-- 0086: anulación of an entrega.
CREATE TRIGGER trg_entrega_anulada_zz_inv_u07_insert
  BEFORE INSERT ON fsj.entrega_anulada
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('anulada_por_id');

-- 0088: the DT co-firma of a pesada real, set at INSERT next to registrado_por_id.
DROP TRIGGER IF EXISTS trg_pesada_real_zz_inv_u07_insert ON fsj.pesada_real;
CREATE TRIGGER trg_pesada_real_zz_inv_u07_insert
  BEFORE INSERT ON fsj.pesada_real
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id', 'autorizado_por_id');

-- 0088: who authorized the real weight of a reserva; may be set after the INSERT.
CREATE TRIGGER trg_reserva_stock_zz_inv_u07_pesada
  BEFORE INSERT OR UPDATE OF pesada_autorizada_por_id ON fsj.reserva_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('pesada_autorizada_por_id');

-- 0093: repartidores (envíos).
CREATE TRIGGER trg_repartidor_zz_inv_u07_insert
  BEFORE INSERT ON fsj.repartidor
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('creado_por_id');

-- 0092, 0110, 0090: borradores of a preparación in progress.
CREATE TRIGGER trg_excipiente_borrador_zz_inv_u07_insert
  BEFORE INSERT ON fsj.excipiente_borrador
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('actualizado_por_id');

CREATE TRIGGER trg_insumo_borrador_zz_inv_u07_insert
  BEFORE INSERT ON fsj.insumo_borrador
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('actualizado_por_id');

CREATE TRIGGER trg_pesada_borrador_zz_inv_u07_insert
  BEFORE INSERT ON fsj.pesada_borrador
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('actualizado_por_id');
