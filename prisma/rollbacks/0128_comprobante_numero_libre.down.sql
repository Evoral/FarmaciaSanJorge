-- Rollback of 0128_comprobante_numero_libre (apply as a NEW forward migration).
-- Restores the 0062 check. It fails while any row holds a number that is not 1-8 digits: fix or remove those
-- comprobantes first (SELECT id, numero FROM fsj.comprobante_compra WHERE numero !~ '^[0-9]{1,8}$').

ALTER TABLE fsj.comprobante_compra DROP CONSTRAINT IF EXISTS comprobante_compra_numero_check;
ALTER TABLE fsj.comprobante_compra
  ADD CONSTRAINT comprobante_compra_numero_check CHECK (numero ~ '^[0-9]{1,8}$');
