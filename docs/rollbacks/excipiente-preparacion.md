# Rollback: excipiente de la preparación

Spec: `docs/specs/excipiente-preparacion.md`. Migration 0092.

## What it added

| File | What |
|---|---|
| `prisma/migrations/20261019190000_0092_excipiente_stock/migration.sql` | `preparacion.excipiente_droga_id` / `excipiente_cantidad` (+ INV-P08 trigger extended); `reserva_stock.linea_pesaje_id` nullable and EGRESO_PREPARACION without línea, both only for the excipiente (triggers); table `fsj.excipiente_borrador` |
| `prisma/rollbacks/0092_excipiente_stock.down.sql` | Reverts it (see its header: refused while línea-less rows exist) |
| `prisma/schema.prisma` | `Preparacion.excipienteDrogaId/excipienteCantidad`, `ReservaStock.lineaPesajeId` optional, `model ExcipienteBorrador` |

### New files (delete on rollback)
- `modules/preparaciones/application/excipiente-preparacion.ts`
- `modules/preparaciones/application/guardar-excipiente-borrador.ts`

### Changed code
- `reservar-stock-preparacion.ts`, `recalcular-reserva-stock.ts`, `registrar-perdida-reserva.ts`, `confirmar-preparacion.ts`: the excipiente steps.
- `datos-confirmacion.ts`, `get-confirmacion-de-ficha.ts`: the excipientes and the draft.
- `infrastructure/preparacion-repository.ts`: excipiente functions; `listReservasDePreparacion` only línea rows; the toma's reservas query LEFT JOINs the línea.
- `ui/actions.ts`, `ui/pesaje-en-toma.tsx`: draft save, row and dialog.
- `app/(app)/preparaciones/recetas/[recetaId]/page.tsx`: the free-text field replaced by a read-only line.

## How to revert

1. Release every reserva holding an excipiente ("Liberar reserva").
2. Revert the code (the commit).
3. Apply `prisma/rollbacks/0092_excipiente_stock.down.sql` as a NEW forward migration, in the same deploy. If an
   excipiente was already descontado, keep its section 2 (those egresos have no línea) -- see the file's header.
4. `npm run db:generate`.
