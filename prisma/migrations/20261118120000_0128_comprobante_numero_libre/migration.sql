-- 0128_comprobante_numero_libre
--
-- The supplier invoice number is the supplier's data, not ours to shape: some print more than 8 digits
-- (e.g. 000500152596). fsj.comprobante_compra.numero drops its '^[0-9]{1,8}$' check for a plain
-- "non-blank, at most 30 characters" one. The app keeps stripping leading zeros of an all-digit number,
-- so the UNIQUE (tenant, proveedor, letra, punto_venta, numero) still catches a repeated import.
--
-- Rollback: prisma/rollbacks/0128_comprobante_numero_libre.down.sql (as a NEW forward migration).

ALTER TABLE fsj.comprobante_compra DROP CONSTRAINT IF EXISTS comprobante_compra_numero_check;
ALTER TABLE fsj.comprobante_compra
  ADD CONSTRAINT comprobante_compra_numero_check CHECK (btrim(numero) <> '' AND char_length(numero) <= 30);
