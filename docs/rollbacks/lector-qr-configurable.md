# Rollback: lector de QR configurable

Spec: `openspec/specs/importacion-receta-qr/spec.md` («Modo del lector», «Modo de la farmacia», «Modo del equipo»,
«Modo efectivo», «El modo no cambia la lectura»). Change: `openspec/changes/lector-qr-configurable/`.

The feature has a **data migration** only (`prisma/migrations/20261102120000_0114_parametro_lector_qr_receta`: one
`fsj.parametro` row per tenant), no schema change.

## Order

1. Revert the code. Without it nothing reads the row, and every panel goes back to showing the camera button
   (the behavior before the feature, which is also `CAMARA`).
2. Apply `prisma/rollbacks/0114_parametro_lector_qr_receta.down.sql` as a NEW forward migration.

Either order works: the current code falls back to `CAMARA` when the row is missing, and the reverted code ignores
the row. Reverting the code first avoids an administrator getting "El parámetro no existe todavía" on save.

## Code

- `modules/recetas/domain/modo-lector-qr.ts`, `modules/recetas/application/get-modo-lector-qr.ts`,
  `getModoLectorQrFarmacia` in `modules/recetas/infrastructure/receta-repository.ts`.
- `modules/recetas/ui/preferencia-lector-qr.ts`, `modules/recetas/ui/importar-receta-qr.tsx`,
  `modules/recetas/ui/nueva-receta.tsx`, `app/(app)/recetas/nuevo/page.tsx`.
- `modules/parametros` (the `OPCION` parametro type: registry, list, form, edit) and
  `app/(app)/admin/configuracion/parametros/page.tsx`.
- `scripts/create-tenant.ts` (the seeded row).

## What is lost

Each farmacia's chosen mode. The per-equipo choices stay in each browser's `localStorage`
(`fsj.lector-qr.<tenantId>`), harmless: nothing reads them after the revert.
