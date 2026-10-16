-- 0080_lista_precio_formato_xls
--
-- docs/specs/costos-proveedor.md (R14, R15). The supplier price list import
-- now reads BOTH .xls (Excel 97-2003, BIFF8, read by the in-repo reader
-- modules/costos-proveedor/infrastructure/leer-xls.server.ts) and .xlsx. The
-- header row of an imported list records the format it was read from
-- (fsj.lista_precio_proveedor.formato), and migration 0079 only allowed
-- 'XLSX' and 'PDF', so the first .xls import would be refused by the CHECK.
--
-- This replaces lista_precio_proveedor_formato_check (same name) with
-- CHECK (formato IN ('XLS', 'XLSX', 'PDF')). 'PDF' stays allowed but unused:
-- the supplier sends Excel, so the PDF parser (stage E7) was dropped.
--
-- ADDITIVE and safe on existing data: every existing row ('XLSX') satisfies
-- the wider CHECK, so adding the constraint validates cleanly. The table is
-- append-only (no UPDATE/DELETE grant, fsj.forbid_update_delete) but that
-- only guards rows, not DDL; the migration role is the table owner.
--
-- Numbering: 0080 follows 0079 in this repository. The shared database also
-- has migrations that were applied from other branches (see the note in
-- 0079) -- re-check `prisma migrate status` before applying.
--
-- *** APPLY 0080 BEFORE DEPLOYING THE CODE THAT USES IT. *** The new code
-- inserts formato 'XLS'; against the 0079 CHECK that insert fails.
-- Rollback: prisma/rollbacks/0080_lista_precio_formato_xls.down.sql (as a NEW
-- forward migration) -- docs/rollbacks/costos-proveedor.md.

ALTER TABLE fsj.lista_precio_proveedor
  DROP CONSTRAINT IF EXISTS lista_precio_proveedor_formato_check;

ALTER TABLE fsj.lista_precio_proveedor
  ADD CONSTRAINT lista_precio_proveedor_formato_check CHECK (formato IN ('XLS', 'XLSX', 'PDF'));
