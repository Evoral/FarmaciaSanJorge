-- Rollback of 0107_iva_costos_cotizacion (apply as a NEW forward migration).
-- Costos and cotizaciones go back to net of IVA only: the IVA figures are dropped (the net ones were never
-- touched). Cotizaciones calculated after 0107 keep their precio_final, which already included IVA.
-- The code must be reverted too (docs/rollbacks/iva-costos-cotizacion.md).

ALTER TABLE fsj.cotizacion DROP CONSTRAINT IF EXISTS cotizacion_costo_insumos_con_iva_check;
ALTER TABLE fsj.cotizacion DROP COLUMN IF EXISTS costo_insumos_con_iva;

ALTER TABLE fsj.costo_proveedor DROP CONSTRAINT IF EXISTS costo_proveedor_costo_unitario_con_iva_check;
ALTER TABLE fsj.costo_proveedor DROP CONSTRAINT IF EXISTS costo_proveedor_precio_informado_con_iva_check;
ALTER TABLE fsj.costo_proveedor DROP CONSTRAINT IF EXISTS costo_proveedor_alicuota_iva_check;
ALTER TABLE fsj.costo_proveedor DROP COLUMN IF EXISTS costo_unitario_con_iva;
ALTER TABLE fsj.costo_proveedor DROP COLUMN IF EXISTS precio_informado_con_iva;
ALTER TABLE fsj.costo_proveedor DROP COLUMN IF EXISTS alicuota_iva;

DELETE FROM fsj.parametro WHERE clave = 'alicuota_iva_porcentaje';
