-- Rollback of 0064_partida_vencimiento_opcional. Apply as a NEW forward
-- migration. Fails while any partida has fecha_vencimiento NULL: give those
-- a date first.
CREATE OR REPLACE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(sum(p.cantidad_disponible) FILTER (WHERE p.fecha_vencimiento >= fsj.jornada_actual(d.tenant_id)), 0) AS stock_disponible
FROM fsj.droga d
LEFT JOIN fsj.partida p ON p.tenant_id = d.tenant_id AND p.droga_id = d.id
GROUP BY d.tenant_id, d.id;

DROP TRIGGER IF EXISTS trg_partida_validar_vencimiento ON fsj.partida;
DROP FUNCTION IF EXISTS fsj.partida_validar_vencimiento();
ALTER TABLE fsj.partida ALTER COLUMN fecha_vencimiento SET NOT NULL;
