-- 0027_proveedor_motivo_baja
--
-- FASE 4, point 4.3 (proveedores). The task's binding decision requires
-- "baja and reactivation with motivo" for proveedores, same as unidad_medida
-- (migration 0006: fecha_baja + motivo_baja) and droga (migration 0007:
-- fecha_baja + motivo_baja). fsj.proveedor (migration 0007) was the only M06
-- catalog that only got fecha_baja -- motivo_baja was missing. The motivo is
-- still ALWAYS captured in fsj.registro_auditoria regardless of this column
-- (every write in this codebase is audited in the same transaction, INV-A01)
-- -- this column is purely the same "why is this currently down" display
-- convenience already present on unidad_medida/droga, added here for
-- consistency rather than displaying it only via a trip to the audit log.
--
-- Purely additive: one nullable column + a column-level grant, matching the
-- shape of the grant migration 0007 already issued for proveedor.fecha_baja.
-- No data migration needed (existing rows simply get motivo_baja = NULL).

ALTER TABLE fsj.proveedor ADD COLUMN IF NOT EXISTS motivo_baja text;

COMMENT ON COLUMN fsj.proveedor.motivo_baja IS
  'FASE 4 point 4.3. Set together with fecha_baja on baja; cleared (NULL) on reactivación. Full history of every baja/reactivación (including its motivo) lives in fsj.registro_auditoria regardless -- this column is a display convenience for "why is this proveedor currently down", matching droga.motivo_baja / unidad_medida.motivo_baja.';

GRANT UPDATE (motivo_baja) ON fsj.proveedor TO fsj_app;
