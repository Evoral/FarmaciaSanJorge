-- 0116_paciente_dni_unico
--
-- User decision (2026-11-03): a paciente's DNI is unique per tenant, like the
-- CUIL (uq_paciente_cuil, migration 0007), dados de baja included. The plan
-- already required it (plan §5 "Unicidades por tenant") but no index existed,
-- so the alta and the edit let the same DNI be loaded twice. The app checks it
-- first (existeDni, modules/pacientes); this index is the net.
--
-- Existing duplicates must be resolved BEFORE applying (one-off data fix: give de
-- baja the sobrante and clear its DNI). The guard below aborts with the list
-- instead of failing on the CREATE INDEX.
--
-- Rollback: prisma/rollbacks/0116_paciente_dni_unico.down.sql.

DO $$
DECLARE repetidos text;
BEGIN
  SELECT string_agg(tenant_id || '/' || dni, ', ') INTO repetidos
  FROM (
    SELECT tenant_id, dni FROM fsj.paciente WHERE dni IS NOT NULL GROUP BY tenant_id, dni HAVING count(*) > 1
  ) d;
  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION '0116: resolve the duplicate paciente DNIs first (tenant/dni): %', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_paciente_dni
  ON fsj.paciente (tenant_id, dni)
  WHERE dni IS NOT NULL;
