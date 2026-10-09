# Rollback: stock in the droga's unidad base (R12)

Spec: `docs/specs/reserva-stock-preparacion.md`, rule R12. Schema change:
migration `prisma/migrations/20261008150000_0073_consumo_linea_en_unidad_base_droga`
(INV-S12 compares in the droga's unidad base). Reverted as code + a NEW forward
migration built from `prisma/rollbacks/0073_consumo_linea_en_unidad_base_droga.down.sql`.

## Why you probably do not want to

Without the fix, a línea in g of a droga kept in mg consumes 1000 times less
stock than it weighs (950 g -> 950 mg), and cotizaciones cost it 1000 times
cheaper. Prefer fixing forward.

## Order

Code and migration go together (same deploy): old code + 0073, or new code
without 0073, rejects (INV-S12) every confirmation of a línea whose unit
differs from its droga's unidad base. Líneas already in the droga's unidad
base work in every combination.

1. Revert the code hunks:
   - `shared/decimal/convertir-unidad.ts` (new file).
   - `modules/preparaciones/application/confirmar-preparacion.ts`
     (`planificarConsumoEnTx` conversion, `LineaPlanificada.cantidadRequeridaStock`),
     `datos-confirmacion.ts`, `partidas-para-pesar.ts`, `reservar-stock-preparacion.ts`
     (audit symbol).
   - `modules/preparaciones/infrastructure/preparacion-repository.ts`
     (`LineaParaPantalla.unidad/unidadStock`, `PartidaElegible.unidadSimbolo`,
     the toma's reserva symbol join).
   - `modules/preparaciones/ui/{confirmar-form,lineas-ficha-tabla}.tsx` (labels).
   - `modules/precios/{domain/calcular-cotizacion.ts,application/cotizar-lineas.ts,application/calcular-cotizacion.ts,infrastructure/cotizacion-repository.ts}`,
     `modules/recetas/application/presupuestar-receta.ts`.
2. Copy `prisma/rollbacks/0073_consumo_linea_en_unidad_base_droga.down.sql` into
   a NEW migration (next free number) and apply it with that deploy.

## Data

Nothing to migrate either way: the fix only changes how new egresos,
reservas and cotizaciones are computed. Movimientos written before the fix
with the wrong unit stay as they are (they were test data when the fix
shipped). Open reservas made with the fix hold droga-unidad-base amounts;
after a rollback, release and redo them ("Liberar reserva").
