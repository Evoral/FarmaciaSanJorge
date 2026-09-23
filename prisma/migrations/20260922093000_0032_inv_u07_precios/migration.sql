-- 0032_inv_u07_precios
--
-- Closes the INV-U07 gap the regression guard in
-- tests/db/inv-u07-actor-activo.test.ts caught: migration 0031 added
-- `fsj.regla_precio.creado_por_id` and `fsj.cotizacion.calculada_por_id`
-- without attaching the actor guard, so the DB would have accepted a
-- PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA user as the author of a price
-- rule or a quote. The app already takes both from the session (and
-- requireSession rejects non-ACTIVO users), but INV-U07 is a [BD + APP]
-- invariant: the database is the guarantee, the app is the convenience.
--
-- Same convention as 0023: one generic function, column names passed via
-- TG_ARGV, trigger named `trg_<table>_zz_inv_u07_insert` so the `zz_`
-- prefix makes it fire last among BEFORE ROW triggers (Postgres fires
-- them alphabetically), leaving earlier invariant errors intact.
-- INSERT only: a historical row must keep resolving after its author is
-- suspended or given de baja (INV-U03).

CREATE TRIGGER trg_regla_precio_zz_inv_u07_insert
  BEFORE INSERT ON fsj.regla_precio
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('creado_por_id');

CREATE TRIGGER trg_cotizacion_zz_inv_u07_insert
  BEFORE INSERT ON fsj.cotizacion
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('calculada_por_id');
