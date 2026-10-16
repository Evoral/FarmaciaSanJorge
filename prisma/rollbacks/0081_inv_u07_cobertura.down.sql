-- Rollback of 0081_inv_u07_cobertura. Apply as a NEW forward migration.
-- No data is lost: only the BEFORE INSERT actor guards go; the app keeps
-- rejecting non-ACTIVO users in requireSession.

DROP TRIGGER IF EXISTS trg_rectificacion_asiento_zz_inv_u07_insert ON fsj.rectificacion_asiento;
DROP TRIGGER IF EXISTS trg_droga_alias_zz_inv_u07_insert ON fsj.droga_alias;
DROP TRIGGER IF EXISTS trg_comprobante_compra_zz_inv_u07_insert ON fsj.comprobante_compra;
DROP TRIGGER IF EXISTS trg_reserva_stock_zz_inv_u07_insert ON fsj.reserva_stock;
DROP TRIGGER IF EXISTS trg_reanalisis_partida_zz_inv_u07_insert ON fsj.reanalisis_partida;
DROP TRIGGER IF EXISTS trg_costo_proveedor_zz_inv_u07_insert ON fsj.costo_proveedor;
DROP TRIGGER IF EXISTS trg_lista_precio_proveedor_zz_inv_u07_insert ON fsj.lista_precio_proveedor;
