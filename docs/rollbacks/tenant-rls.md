# Rollback: RLS on fsj.tenant

The change (security audit P1-02) enables and forces RLS on `fsj.tenant` with the standard `tenant_isolation` policy (`id = fsj.current_tenant_id()`), so `fsj_app` only sees the current tenant's row. The two daily jobs, which run without `app.tenant_id`, list active tenants through the new SECURITY DEFINER `fsj.listar_tenants_activos()` (ids only).

It has a **schema change** (migration `prisma/migrations/20261104130000_0119_tenant_rls`), so it is reverted as code + a new forward migration built from `prisma/rollbacks/0119_tenant_rls.down.sql`.

## What the down migration loses

- No data. It reopens P1-02: `fsj_app` can read every tenant's row again.

## Order

1. Deploy the reverted code **first**. Until step 2, the reverted jobs' `tx.tenant.findMany` runs under RLS without a tenant and sees zero tenants: the jobs do nothing (no error, no data change).
2. Copy `prisma/rollbacks/0119_tenant_rls.down.sql` into a NEW migration folder (next free number, a timestamp later than every existing one) and apply it forward. Never edit or delete the applied 0119 migration.
3. `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `prisma/rollbacks/0119_tenant_rls.down.sql` and this file (optional)
- `prisma/migrations/20261104130000_0119_tenant_rls/` (keep once applied)

## Edited files (revert)

- `modules/archivo/infrastructure/archivo-repository.ts` and `modules/entregas/infrastructure/retiro-vencido-repository.ts`: `listActiveTenantIds` back to `tx.tenant.findMany({ where: { fechaBaja: null }, select: { id: true } })`.
- `modules/auth/infrastructure/session-repository.ts`: comments only (the unused `loadTenantFechaBaja` was deleted; no need to restore it).
- `tests/db/tenant-parametro.test.ts`: the cross-tenant UPDATE test back to expecting `INV-PL-004`; remove the `0119_tenant_rls` describe block.
- `docs/auditoria/informes/parte-6.md`: P1-02 back to open.
