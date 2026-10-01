-- Rollback of 0051_trayectoria_paciente_indices (docs/rollbacks/trayectoria-paciente.md).
-- Prisma has no "down": apply this as the body of a NEW forward migration
-- (0052_revert_trayectoria_paciente_indices). It only drops what 0051
-- created; nothing else depends on these indexes (they back read queries
-- only -- no constraint, no FK, no trigger uses them).

DROP INDEX IF EXISTS fsj.idx_receta_tenant_paciente_ingreso;
DROP INDEX IF EXISTS fsj.idx_item_receta_tenant_receta;
DROP INDEX IF EXISTS fsj.idx_preparacion_tenant_item_receta;
