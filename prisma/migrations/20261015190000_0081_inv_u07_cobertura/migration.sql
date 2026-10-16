-- 0081_inv_u07_cobertura
--
-- Closes the INV-U07 gap the regression guard in
-- tests/db/inv-u07-actor-activo.test.ts caught (same situation as 0032):
-- migrations 0033, 0049, 0062, 0071, 0074 and 0079 added actor columns
-- without attaching the actor guard, so the DB would accept a
-- PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA user as the author of these rows.
-- The app takes every one of them from the session (requireSession rejects
-- non-ACTIVO users), but INV-U07 is a [BD + APP] invariant: the database is
-- the guarantee, the app is the convenience.
--
-- Same convention as 0023/0032: one generic function, column names passed
-- via TG_ARGV, trigger named `trg_<table>_zz_inv_u07_insert` so the `zz_`
-- prefix makes it fire last among BEFORE ROW triggers (Postgres fires them
-- alphabetically), leaving earlier invariant errors (e.g. INV-U05 on
-- rectificacion_asiento.autorizado_por_id) intact. INSERT only: every column
-- below is NOT NULL and written once at INSERT, and a historical row must keep
-- resolving after its author is suspended or given de baja (INV-U03).
--
-- Only BEFORE INSERT triggers are added: existing rows are not re-validated.
-- Rollback: prisma/rollbacks/0081_inv_u07_cobertura.down.sql (as a NEW
-- forward migration).

-- 0033: authorization record of a RECTIFICATIVO asiento.
CREATE TRIGGER trg_rectificacion_asiento_zz_inv_u07_insert
  BEFORE INSERT ON fsj.rectificacion_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('autorizado_por_id', 'registrado_por_id');

-- 0049: droga synonyms learned from imported recetas.
CREATE TRIGGER trg_droga_alias_zz_inv_u07_insert
  BEFORE INSERT ON fsj.droga_alias
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('creado_por_id');

-- 0062: purchase receipt.
CREATE TRIGGER trg_comprobante_compra_zz_inv_u07_insert
  BEFORE INSERT ON fsj.comprobante_compra
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- 0071: stock reservation for a preparacion.
CREATE TRIGGER trg_reserva_stock_zz_inv_u07_insert
  BEFORE INSERT ON fsj.reserva_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('reservada_por_id');

-- 0074: partida re-analysis by the DT.
CREATE TRIGGER trg_reanalisis_partida_zz_inv_u07_insert
  BEFORE INSERT ON fsj.reanalisis_partida
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- 0079: supplier reference prices.
CREATE TRIGGER trg_costo_proveedor_zz_inv_u07_insert
  BEFORE INSERT ON fsj.costo_proveedor
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('creado_por_id');

CREATE TRIGGER trg_lista_precio_proveedor_zz_inv_u07_insert
  BEFORE INSERT ON fsj.lista_precio_proveedor
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');
