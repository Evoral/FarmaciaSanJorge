# Rollback: Logo de la farmacia

Spec: `docs/specs/logo-farmacia.md`. The feature has a **schema change** (migration
`prisma/migrations/20261022120000_0098_tenant_logo`), so it is reverted as code + a new forward migration built
from `prisma/rollbacks/0098_tenant_logo.down.sql`.

## What the down migration loses

- Every uploaded logo (the bytes live only in `fsj.tenant.logo`). The navbar goes back to `public/logo.png`.
- The audit rows of the uploads stay (they never held the bytes).

## Order

1. Deploy the reverted code **first**: it neither reads nor writes the logo columns, and they are nullable, so it
   runs fine against the 0098 schema.
2. Copy `prisma/rollbacks/0098_tenant_logo.down.sql` into a NEW migration folder (next free number, a timestamp
   later than every existing one) and apply it. Never edit or delete the applied 0098 migration.
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/farmacia/domain/logo.ts`
- `modules/farmacia/application/cambiar-logo-tenant.ts`, `quitar-logo-tenant.ts`, `get-marca-tenant.ts`
- `modules/farmacia/ui/logo-tenant-form.tsx`
- `app/api/farmacia/logo/route.ts`
- `docs/specs/logo-farmacia.md`, `prisma/rollbacks/0098_tenant_logo.down.sql` and this file (optional)
- `prisma/migrations/20261022120000_0098_tenant_logo/` (keep it once applied)

## Edited files (revert the logo hunks)

- `prisma/schema.prisma`: `logo`, `logoTipo`, `logoActualizadoEn` in `model Tenant`.
- `modules/farmacia/infrastructure/tenant-repository.ts`: `MarcaTenant`, `getMarcaTenant`, `LogoTenant`,
  `getLogoTenant`, `updateLogoTenant`.
- `modules/farmacia/ui/actions.ts`: `cambiarLogoTenantAction`, `quitarLogoTenantAction`.
- `app/(app)/admin/configuracion/farmacia/page.tsx`: the "Logo" panel.
- `app/(app)/layout.tsx` and `app/(app)/sidebar-nav.tsx`: the `farmacia` / `logoSrc` props and `Brand` (back to the
  fixed `/logo.png` and "Farmacia San Jorge").
- `DESIGN.md`: the logo assets note.
