# Rollback: incidentes de integridad en /plataforma

Spec: `openspec/specs/libro-recetario-y-contralor/spec.md` and `openspec/specs/plataforma/spec.md` (P8, P9, P17 to P19;
until archived, the deltas live in `openspec/changes/incidentes-integridad-plataforma/specs/`). The feature has a
**schema change** (migration `prisma/migrations/20261111130000_0129_libro_incidente_integridad`), so it is reverted as
code + a new forward migration built from `prisma/rollbacks/0129_libro_incidente_integridad.down.sql`.

## What the down migration loses

- **The whole incident history** (`fsj.libro_incidente_integridad`, every tenant). Export it first, as owner:
  `COPY (SELECT * FROM fsj.libro_incidente_integridad) TO STDOUT WITH CSV HEADER;`
- Nothing else. The libro banner never depended on the table, and no asiento, hash or audit row is touched.

## Order

1. Deploy the reverted code **first** (the two commits below). The old code never calls
   `fsj.libro_incidente_registrar` nor `fsj.plataforma_incidentes_integridad`, so it runs fine against the 0129 schema.
2. Export the incident history if it matters (see above).
3. Copy `prisma/rollbacks/0129_libro_incidente_integridad.down.sql` into a NEW migration folder (next free number, a
   timestamp later than every existing one) and apply it. Never edit or delete the applied 0129 migration. It drops
   both functions, the table (policy, triggers, indexes go with it) and `fsj.libro_incidente_validar()`.
   For the second database (`.env.prod`) use the exact command in `docs/deploy.md` §4.
4. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Never apply the down SQL before the code is reverted: the layout would fail to register incidents (it is fail-soft, so
it only logs a warning) and `/plataforma` would error on the missing function.

## Commits to revert (newest first)

- `5eb6043` feat(plataforma): show integrity incidents in pharmacy list and detail
- `4e7c498` feat(libro): register integrity incidents on cache miss
- `bdc4d40` feat(libro): add libro_incidente_integridad table and functions (0129): revert the code hunks only; keep the
  migration folder once applied

## New files (delete on rollback)

- `modules/libro/application/registrar-incidentes-integridad.ts`
- `modules/libro/infrastructure/incidente-integridad-repository.ts`
- `modules/plataforma/ui/incidentes-integridad.tsx`
- `tests/db/libro-incidente-integridad.test.ts`, `tests/unit/registrar-incidentes-integridad.test.ts`,
  `tests/unit/resumen-integridad.test.ts`
- `prisma/rollbacks/0129_libro_incidente_integridad.down.sql` and this file (optional)
- `prisma/migrations/20261111130000_0129_libro_incidente_integridad/` (keep it once applied)

## Edited files (revert the incident hunks)

- `app/(app)/layout.tsx`: back to `resumenIntegridad()` with no registration call.
- `app/(plataforma)/plataforma/page.tsx`: the "Integridad" badge. `app/(plataforma)/plataforma/farmacias/[id]/page.tsx`:
  the `#integridad` section.
- `modules/libro/application/resumen-integridad.ts`, `modules/libro/domain/integridad.ts`: `resumenIntegridadConVerificacion`
  and `VerificacionLibro`.
- `modules/plataforma/application/listar-farmacias.ts`, `ver-farmacia.ts`, `modules/plataforma/domain/farmacia.ts`,
  `modules/plataforma/infrastructure/plataforma-repository.ts`: `incidentesAbiertos`, `IncidenteIntegridad`,
  `incidentesIntegridad`.
- `shared/errors/mensajes-invariantes.ts`: `INV-L27`. `shared/labels/field-labels.ts`: `libros`, `quiebre`.
- `tests/db/grants-finales.test.ts`, `tests/unit/plataforma-usecases.test.ts`.
