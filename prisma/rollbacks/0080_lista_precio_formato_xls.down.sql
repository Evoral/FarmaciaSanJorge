-- Rollback of 0080_lista_precio_formato_xls. Apply as a NEW forward migration,
-- AFTER deploying the code that no longer writes formato 'XLS'
-- (docs/rollbacks/costos-proveedor.md).
--
-- Restores CHECK (formato IN ('XLSX', 'PDF')). It FAILS (23514, check
-- constraint violated by some row) if any list was imported from an .xls
-- while 0080 was live: fsj.lista_precio_proveedor is append-only (no
-- UPDATE/DELETE grant, fsj.forbid_update_delete), so those rows can not be
-- rewritten by the app. Check first:
--
--   SELECT count(*) FROM fsj.lista_precio_proveedor WHERE formato = 'XLS';
--
-- If the count is not 0, the options are:
--   a) Do NOT roll this migration back. The wider CHECK is harmless to the
--      reverted code (it never writes 'XLS'; it only reads `formato` as text).
--      This is the recommended option.
--   b) As the owner role (`postgres`, DIRECT_URL), in the same transaction as
--      this script, relabel the rows and re-enable the guard:
--        ALTER TABLE fsj.lista_precio_proveedor DISABLE TRIGGER trg_lista_precio_proveedor_forbid_update_delete;
--        UPDATE fsj.lista_precio_proveedor SET formato = 'XLSX' WHERE formato = 'XLS';
--        ALTER TABLE fsj.lista_precio_proveedor ENABLE TRIGGER trg_lista_precio_proveedor_forbid_update_delete;
--      This falsifies the recorded format of those lists (and is outside the
--      append-only guarantee): export them first, and only do it knowingly.

ALTER TABLE fsj.lista_precio_proveedor
  DROP CONSTRAINT IF EXISTS lista_precio_proveedor_formato_check;

ALTER TABLE fsj.lista_precio_proveedor
  ADD CONSTRAINT lista_precio_proveedor_formato_check CHECK (formato IN ('XLSX', 'PDF'));
