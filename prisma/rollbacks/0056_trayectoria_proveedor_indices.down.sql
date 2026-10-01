-- Rollback of 0056_trayectoria_proveedor_indices (docs/rollbacks/trayectoria-proveedor.md).
-- Prisma has no "down": apply this as the body of a NEW forward migration
-- (next free number after 0056, e.g. 0057_revert_trayectoria_proveedor_indices
-- -- check prisma/migrations first). It only drops what 0056 created; nothing
-- else depends on this index (it backs read queries only -- no constraint,
-- no FK, no trigger uses it).

DROP INDEX IF EXISTS fsj.idx_partida_tenant_proveedor_ingreso;
