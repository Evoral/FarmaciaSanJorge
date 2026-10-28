# Rollback: Pesada real

Spec: `openspec/specs/pesada-real/spec.md`. Migration 0088.

## What it changed

### Database
| File | Change |
|---|---|
| `prisma/migrations/20261019090000_0088_pesada_real/migration.sql` | `reserva_stock.cantidad_real` / `pesada_autorizada_por_id`; table `fsj.pesada_real` (immutable, DT co-firma trigger); INV-S12 revised; parameter `tolerancia_pesada_porcentaje` = 5 for every tenant |
| `prisma/rollbacks/0088_pesada_real.down.sql` | Restores 0073's INV-S12, drops the table, columns and parameter |
| `prisma/schema.prisma` | `cantidadReal`, `pesadaAutorizadaPorId` in `model ReservaStock` |

### New files (delete on rollback)
- `modules/preparaciones/domain/pesada-real.ts`
- `modules/preparaciones/application/co-firma-pesada-real.ts`

### Changed code
- `modules/preparaciones/application/confirmar-preparacion.ts`: `cantidadReal` entrada, lot choice for every línea, tolerance check, `pesada_real` insert, co-firma in `confirmarPreparacion`.
- `reservar-stock-preparacion.ts`, `recalcular-reserva-stock.ts`, `registrar-perdida-reserva.ts`, `confirmar-desde-reservas.ts`, `datos-confirmacion.ts`, `get-recalculo-de-reserva.ts`: carry the pesada real and the co-firma.
- `modules/preparaciones/domain/reparto-linea.ts`: `repartirPesadaReal`.
- `modules/preparaciones/infrastructure/preparacion-repository.ts`: reserva fields, `getParametrosPesadaReal`, `insertPesadaReal`.
- `modules/preparaciones/ui/confirmar-form.tsx`, `ui/actions.ts`: lots, pesada real field, co-firma.
- `modules/parametros/domain/parametros-registry.ts`, `scripts/create-tenant.ts`: the parameter.

## How to revert

1. Revert the code (the commit).
2. Apply `prisma/rollbacks/0088_pesada_real.down.sql` as a NEW forward migration, in the same deploy.
3. `npm run db:generate`.

Líneas already confirmed with a real weighing keep their movimientos (the deferred INV-S12 only runs for new
egresos). Reservas holding a `cantidad_real` lose it: the next "Imprimir etiquetas" consumes the theoretical weight.

## Migration 0103 (2026-10-23)

`0103_pesada_real_jornada` only redefines `fsj.pesada_real_validar_autorizacion` to use `fsj.jornada_actual(tenant_id)` instead of `current_date`. Revert it alone with `prisma/rollbacks/0103_pesada_real_jornada.down.sql` as a NEW forward migration; rolling back 0088 drops the trigger function anyway.
