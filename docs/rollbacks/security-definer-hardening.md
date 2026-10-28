# Rollback: SECURITY DEFINER hardening (migration 0101)

Origin: pre-production audit, part 1 (`docs/auditoria/informes/parte-1.md`, P1-01, P1-03 and P1-04).

## What it changed

- `fsj.cierre_diario_firmar` refuses a `p_tenant_id` different from `fsj.current_tenant_id()`
  (also when no tenant is set). Body otherwise identical to migration 0097.
- `fsj.lote_archivo_recetas_asignar_numero` gets `SET search_path = fsj, extensions`.
- No `fsj` routine is executable by PUBLIC; `fsj_app` keeps EXECUTE on the ones it could run before. Default privileges: new routines created by `postgres` are not PUBLIC; new `fsj` routines are executable by `fsj_app`.
- `shared/env.ts` no longer requires `DIRECT_URL` at runtime (P1-07). No DB impact.

## Reverting

1. Run `prisma/rollbacks/0101_security_definer_hardening.down.sql` with the owner role.
2. Delete the `20261023150000_0101_security_definer_hardening` row from `public._prisma_migrations`.
3. Revert the code commit (the `tests/db/fixtures.ts` tenant context line is harmless either way).

No data is touched: the migration only redefines functions and privileges. Side effect: the Supabase login roles `supabase_read_only_user` (read-only SQL editor / read-only MCP) and `supabase_etl_admin` (ETL pipelines) can no longer call `fsj` routines directly (`SELECT fsj.x(...)`). Their table reads keep working: both have BYPASSRLS, so no RLS policy (and no `fsj.current_tenant_id()`) is evaluated for them. `pg_read_all_data` is a non-login group that never granted EXECUTE. `postgres` owns every routine and is unaffected.
