-- Rollback of 0062_comprobante_compra. Apply as a NEW forward migration.
DROP INDEX IF EXISTS fsj.idx_partida_tenant_comprobante_compra;
ALTER TABLE fsj.partida DROP CONSTRAINT IF EXISTS partida_comprobante_compra_fkey;
ALTER TABLE fsj.partida
  DROP COLUMN IF EXISTS pais_origen,
  DROP COLUMN IF EXISTS despacho_importacion,
  DROP COLUMN IF EXISTS comprobante_compra_id;
DROP TABLE IF EXISTS fsj.comprobante_compra;
