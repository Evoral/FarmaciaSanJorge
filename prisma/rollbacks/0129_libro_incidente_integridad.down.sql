-- Rollback of 0129_libro_incidente_integridad (apply as a NEW forward migration). Revert the code FIRST (the layout
-- call to registrarIncidentesIntegridad and the /plataforma incidents UI): docs/rollbacks/incidentes-integridad-plataforma.md.
-- *** DROPS THE WHOLE INCIDENT HISTORY. *** Export it first, as owner:
--   COPY (SELECT * FROM fsj.libro_incidente_integridad) TO STDOUT WITH CSV HEADER;
-- The libro banner never depended on the table, so nothing else changes.

DROP FUNCTION IF EXISTS fsj.plataforma_incidentes_integridad(text, uuid[], boolean, integer);
DROP FUNCTION IF EXISTS fsj.libro_incidente_registrar(uuid, bigint);

-- Policy, triggers and indexes go with the table.
DROP TABLE IF EXISTS fsj.libro_incidente_integridad;

DROP FUNCTION IF EXISTS fsj.libro_incidente_validar();
