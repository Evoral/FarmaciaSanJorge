-- 0025_v_stock_droga_jornada
--
-- fsj.v_stock_droga (migration 0008) excluded expired partidas with
-- `fecha_vencimiento >= CURRENT_DATE` -- the server/UTC date, NOT the
-- tenant's jornada (business date) in its own zona_horaria. For a Mendoza
-- tenant (UTC-3, the DEFAULT zona_horaria, migration 0001) this is wrong
-- for 3 real hours every night: at 22:00 local (01:00 UTC the next day),
-- CURRENT_DATE has already rolled over to tomorrow while the tenant's
-- jornada is still today, so a partida expiring "today" (still legitimately
-- available all day today) is already excluded from stock_disponible.
--
-- Migration 0014 already fixed the analogous bugs in
-- fsj.movimiento_stock_validar_ajuste (INV-U05) and
-- fsj.movimiento_stock_aplicar (INV-S10) by switching them to
-- fsj.jornada_actual(tenant_id) -- see that migration's header point 9.
-- fsj.v_stock_droga was missed. This migration applies the same fix.
--
-- ============================================================================
-- CREATE OR REPLACE VIEW preserves grants/security_invoker for a
-- compatible replacement (same columns, names, types, order) -- verified
-- against the live DB before writing this: fsj_app currently has
-- SELECT + INSERT on fsj.v_stock_droga (the INSERT grant is a harmless
-- side effect of a broader "grants finales" GRANT ALL ON ALL TABLES
-- statement elsewhere; a plain view has no INSERT rule/trigger, so it
-- always fails at execution time regardless) and the view has
-- security_invoker = true (migration 0008, required for INV-T01 to hold
-- through it). Both are preserved explicitly below rather than relied on
-- implicitly, since WITH options are NOT automatically carried over by
-- CREATE OR REPLACE VIEW.
--
-- fsj.jornada_actual(d.tenant_id), not p.tenant_id: the FILTER clause
-- evaluates per (droga, partida) row of the LEFT JOIN, and the join
-- condition (p.tenant_id = d.tenant_id) already guarantees they are equal
-- for any row where p is not NULL; d.tenant_id is also defined for the
-- droga-with-zero-partidas case (LEFT JOIN), so this is the correct column
-- to key the jornada lookup on either way.
-- ============================================================================
CREATE OR REPLACE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(sum(p.cantidad_disponible) FILTER (WHERE p.fecha_vencimiento >= fsj.jornada_actual(d.tenant_id)), 0) AS stock_disponible
FROM fsj.droga d
LEFT JOIN fsj.partida p ON p.tenant_id = d.tenant_id AND p.droga_id = d.id
GROUP BY d.tenant_id, d.id;

COMMENT ON VIEW fsj.v_stock_droga IS
  'M06/M07. stock_disponible = SUM(partida.cantidad_disponible) over non-expired partidas only (fecha_vencimiento >= fsj.jornada_actual(tenant_id) -- the TENANT''s jornada, not CURRENT_DATE/server date; fixed by migration 0025, see its header). Do not sum in the application when this view exists (plan §9 M07 "NO HACER").';

GRANT SELECT, INSERT ON fsj.v_stock_droga TO fsj_app;
