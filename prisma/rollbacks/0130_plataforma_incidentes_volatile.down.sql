-- Rollback of 0130_plataforma_incidentes_volatile (apply as a NEW forward migration). Back to the 0129 declaration.
-- Revert this one BEFORE 0129's down (docs/rollbacks/incidentes-integridad-plataforma.md).
ALTER FUNCTION fsj.plataforma_incidentes_integridad(text, uuid[], boolean, integer) STABLE;
