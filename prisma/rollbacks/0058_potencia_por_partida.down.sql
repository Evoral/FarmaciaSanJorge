-- Rollback of 0058_potencia_por_partida. Prisma has no "down": apply this as
-- the body of a NEW forward migration (next free number).
--
-- DATA LOSS: dropping the columns discards every partida's declared purity,
-- every droga's "requiere corrección por pureza" flag and the purity snapshot
-- of every EGRESO_PREPARACION. movimiento_stock.cantidad (physical) is kept,
-- so stock balances are unaffected.

DO $
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'fsj'
      AND table_name = 'droga'
      AND column_name = 'requiere_correccion_potencia'
  ) THEN
    REVOKE UPDATE (requiere_correccion_potencia) ON fsj.droga FROM fsj_app;
  END IF;
END
$;

ALTER TABLE fsj.movimiento_stock DROP CONSTRAINT IF EXISTS movimiento_stock_potencia_aplicada_check;
ALTER TABLE fsj.partida DROP CONSTRAINT IF EXISTS partida_potencia_declarada_check;

ALTER TABLE fsj.movimiento_stock DROP COLUMN IF EXISTS potencia_aplicada;
ALTER TABLE fsj.droga DROP COLUMN IF EXISTS requiere_correccion_potencia;
ALTER TABLE fsj.partida DROP COLUMN IF EXISTS potencia_declarada;
