-- 0130. fsj.plataforma_incidentes_integridad (0129) was declared STABLE but calls fsj.plataforma_actor (0124), which
-- is VOLATILE: after one minute it UPDATEs the platform session. A STABLE function must not write. Declare it VOLATILE.
-- 0129 is already applied, so its checksum must not change: this is a new forward migration.
-- Rollback: prisma/rollbacks/0130_plataforma_incidentes_volatile.down.sql
ALTER FUNCTION fsj.plataforma_incidentes_integridad(text, uuid[], boolean, integer) VOLATILE;
