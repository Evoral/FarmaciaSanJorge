# Rollback: A query without a tenant fails

The change (security audit P1-09) makes `fsj.current_tenant_id()` raise SQLSTATE `TN001` when `app.tenant_id` is not set, instead of returning NULL. Before it, every RLS policy hid every row, so a query run outside `withTenantTransaction` returned an empty list and an UPDATE silently changed nothing. It adds `fsj.tenant_no_fijado()` (raises) and `fsj.tenant_id_o_null()` (the old NULL behaviour, used only by `trg_tenant_forbid_cross_tenant_update`).

It has a **schema change** (migration `prisma/migrations/20261105130000_0122_tenant_obligatorio`) and **no code change** (one comment in `shared/db/transaction.ts`), so it is reverted as a new forward migration built from `prisma/rollbacks/0122_tenant_obligatorio.down.sql`.

## What the down migration loses

- No data. It reopens P1-09: a query without a tenant sees zero rows again, with no error.

## Order

1. Copy `prisma/rollbacks/0122_tenant_obligatorio.down.sql` into a NEW migration folder (next free number, a timestamp later than every existing one) and apply it forward. Never edit or delete the applied 0122 migration.
2. Revert the DB tests that expect `TN001` back to expecting zero rows (or the functions' own messages).

## New files (delete on rollback)

- `prisma/rollbacks/0122_tenant_obligatorio.down.sql` and this file (optional)
- `prisma/migrations/20261105130000_0122_tenant_obligatorio/` (keep once applied)

## Edited files (revert)

- `shared/db/transaction.ts`: the `withPlatformTransaction` comment.
- `docs/auditoria/informes/parte-6.md`: P1-09 back to open.
- DB tests updated for `TN001` (see the commit that follows this change).
