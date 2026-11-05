-- Rollback of 0123_inv_u07_cobertura_faltante. Apply as a NEW forward migration.
-- No data is lost: only actor guards go; the app keeps rejecting non-ACTIVO
-- users in requireSession. pesada_real gets back its 0088 trigger.

DROP TRIGGER IF EXISTS trg_entrega_anulada_zz_inv_u07_insert ON fsj.entrega_anulada;
DROP TRIGGER IF EXISTS trg_reserva_stock_zz_inv_u07_pesada ON fsj.reserva_stock;
DROP TRIGGER IF EXISTS trg_repartidor_zz_inv_u07_insert ON fsj.repartidor;
DROP TRIGGER IF EXISTS trg_excipiente_borrador_zz_inv_u07_insert ON fsj.excipiente_borrador;
DROP TRIGGER IF EXISTS trg_insumo_borrador_zz_inv_u07_insert ON fsj.insumo_borrador;
DROP TRIGGER IF EXISTS trg_pesada_borrador_zz_inv_u07_insert ON fsj.pesada_borrador;

DROP TRIGGER IF EXISTS trg_pesada_real_zz_inv_u07_insert ON fsj.pesada_real;
CREATE TRIGGER trg_pesada_real_zz_inv_u07_insert
  BEFORE INSERT ON fsj.pesada_real
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');
