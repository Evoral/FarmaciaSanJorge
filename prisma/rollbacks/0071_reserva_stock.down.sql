-- Rollback of 0071_reserva_stock. Apply as a NEW forward migration, together
-- with the code that confirms at "Continuar" again. Open reservas are lost:
-- their preparaciones stay INICIADA (confirm or discard them from
-- /preparaciones/[id]). The view goes back to its 0064 body first, since it
-- depends on the table.
CREATE OR REPLACE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(sum(p.cantidad_disponible) FILTER (WHERE p.fecha_vencimiento IS NULL OR p.fecha_vencimiento >= fsj.jornada_actual(d.tenant_id)), 0) AS stock_disponible
FROM fsj.droga d
LEFT JOIN fsj.partida p ON p.tenant_id = d.tenant_id AND p.droga_id = d.id
GROUP BY d.tenant_id, d.id;

COMMENT ON VIEW fsj.v_stock_droga IS
  'M06/M07. stock_disponible = SUM(partida.cantidad_disponible) over non-expired partidas only (fecha_vencimiento NULL -- does not expire, 0064 -- or >= fsj.jornada_actual(tenant_id), 0025). Do not sum in the application when this view exists (plan §9 M07 "NO HACER").';

DROP TABLE IF EXISTS fsj.reserva_stock;
