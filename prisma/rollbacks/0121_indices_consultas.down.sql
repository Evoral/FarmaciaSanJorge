-- Rollback of 0121_indices_consultas (apply as a NEW forward migration). No code depends on these indexes, so the
-- order with the code does not matter. No data is lost; the queries listed in 0121 go back to scanning.

DROP INDEX IF EXISTS fsj.idx_asiento_recetario_pendientes;
DROP INDEX IF EXISTS fsj.idx_asiento_contralor_pendientes;
DROP INDEX IF EXISTS fsj.idx_asiento_recetario_tenant_fecha;
DROP INDEX IF EXISTS fsj.idx_movimiento_stock_linea_pesaje;
DROP INDEX IF EXISTS fsj.idx_movimiento_stock_preparacion;
DROP INDEX IF EXISTS fsj.idx_receta_tenant_medico;
DROP INDEX IF EXISTS fsj.idx_receta_tenant_lote_archivo;
DROP INDEX IF EXISTS fsj.idx_sesion_usuario_activas;
DROP INDEX IF EXISTS fsj.idx_elaboracion_lote_formula;
