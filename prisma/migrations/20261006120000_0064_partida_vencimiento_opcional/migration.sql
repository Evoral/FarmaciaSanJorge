-- 0064_partida_vencimiento_opcional
--
-- Client decision (2026-10-06): insumos such as capsules have no expiry
-- date. fsj.partida.fecha_vencimiento becomes NULLable -- "does not
-- expire" -- but ONLY for a partida of an insumo (droga.clase <> 'DROGA',
-- migration 0063). A DROGA partida still requires it.
--
--   1. DROP NOT NULL on fsj.partida.fecha_vencimiento.
--   2. trg_partida_validar_vencimiento (BEFORE INSERT): rejects a NULL
--      fecha_vencimiento when the droga's clase is DROGA. The column is
--      insert-only for fsj_app (0008's per-column UPDATE grant does not
--      include it), so INSERT is the only path to check.
--   3. fsj.v_stock_droga: a partida that does not expire counts as
--      available (the FILTER was `fecha_vencimiento >= jornada`, which is
--      NULL -- excluded -- for such a row).
--
-- Existing checks re-read: INV-S10 (0014, fsj.movimiento_stock_validar_*:
-- `IF v_fecha_vencimiento < jornada THEN RAISE`) evaluates NULL as not
-- expired -- correct as is. No other SQL object reads the column.
--
-- Numbering: 0063 (20261006090000_0063_clase_droga) is the highest at the
-- time of writing -- re-check before applying.
--
-- *** APPLY 0064 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0064_partida_vencimiento_opcional.down.sql (as
-- a NEW forward migration; it fails while any partida has no expiry).

ALTER TABLE fsj.partida ALTER COLUMN fecha_vencimiento DROP NOT NULL;

COMMENT ON COLUMN fsj.partida.fecha_vencimiento IS
  '0064. NULL = does not expire -- allowed only for an insumo (droga.clase <> DROGA, trg_partida_validar_vencimiento). Insert-only for fsj_app.';

CREATE OR REPLACE FUNCTION fsj.partida_validar_vencimiento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_clase fsj.clase_droga;
BEGIN
  IF NEW.fecha_vencimiento IS NULL THEN
    SELECT clase INTO v_clase FROM fsj.droga WHERE tenant_id = NEW.tenant_id AND id = NEW.droga_id;
    IF v_clase = 'DROGA' THEN
      RAISE EXCEPTION 'INV-S21: a partida of a droga (clase DROGA) requires fecha_vencimiento' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.partida_validar_vencimiento() IS
  'INV-S21 (migration 0064): fecha_vencimiento may be NULL (does not expire) only for an insumo (droga.clase <> DROGA).';

DROP TRIGGER IF EXISTS trg_partida_validar_vencimiento ON fsj.partida;
CREATE TRIGGER trg_partida_validar_vencimiento
  BEFORE INSERT ON fsj.partida
  FOR EACH ROW EXECUTE FUNCTION fsj.partida_validar_vencimiento();

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
