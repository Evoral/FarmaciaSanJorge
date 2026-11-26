# Rollback: Solución de uso interno / externo (migración 0135)

Spec: `openspec/specs/etiqueta-preparado/spec.md` (R14). The feature has a **schema change**
(migration `prisma/migrations/20261125120000_0135_solucion_uso_interno_externo`), so it is reverted as code + a new
forward migration built from `prisma/rollbacks/0135_solucion_uso_interno_externo.down.sql`.

## What the down migration loses

- Nothing while no ítem uses "Solución uso externo": `SOLUCION_USO_INTERNO` is renamed back to `SOLUCION`.
- The down migration **refuses** while an ítem or the fondo rojo configuration uses `SOLUCION_USO_EXTERNO`: decide
  first what those ítems become (there is no correct automatic answer) and remove it from the configuration.
- Postgres can not drop an enum value: `SOLUCION_USO_EXTERNO` stays in the type, unused.

## Order

1. Deploy the reverted code **first** (it only knows `SOLUCION`; with the renamed value still in place it would read
   unknown formas).
2. Copy `prisma/rollbacks/0135_solucion_uso_interno_externo.down.sql` into a NEW forward migration and apply it manually.

## Code

Revert the feature's commit. It touches `prisma/schema.prisma` (`FormaFarmaceutica`),
`modules/recetas/domain/receta.ts` (`FORMAS_FARMACEUTICAS`), `modules/elaboracion/domain/calcular-ficha-tecnica.ts`,
`shared/labels/enum-labels.ts`, `modules/preparaciones/domain/etiqueta.ts` (vía, plural, singular on the etiqueta),
`prisma/seed-demo.ts`, the unit tests that named `SOLUCION`, the spec, this file and the migration / rollback files.
