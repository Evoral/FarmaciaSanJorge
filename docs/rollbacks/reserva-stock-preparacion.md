# Rollback: Reserva de stock de una preparación

Spec: `docs/specs/reserva-stock-preparacion.md`. The feature has **schema changes**
(migrations `prisma/migrations/20261008090000_0071_reserva_stock` and
`20261008120000_0072_receta_editable_sin_preparacion_viva`), so it is reverted as
code + new forward migrations built from `prisma/rollbacks/0072_receta_editable_sin_preparacion_viva.down.sql`
and then `prisma/rollbacks/0071_reserva_stock.down.sql` (newest first).

### 0072 (receta editable again after liberar)

Reverting it restores INV-R11's "any preparación blocks deleting items" and the
code that moves the receta to EN_PREPARACION when a preparación is started.
Recetas left PENDIENTE_PREPARACION with a live preparación INICIADA keep that
estado (the reverted code moves them at their next start, not retroactively);
move them by hand only if the old "EN_PREPARACION while preparing" listing
matters. Code hunks: `iniciar-preparacion.ts` (estado move), `confirmar-preparacion.ts`
step 8 (PENDIENTE → EN_PREPARACION), `modules/recetas/{infrastructure/receta-repository.ts,application/editar-receta.ts,domain/receta.ts}`,
`app/(app)/recetas/[id]/page.tsx`, `app/(app)/recetas/[id]/editar/page.tsx`, the toma page's `puedeEditar`.

## Before rolling back

Open reservas are lost with the table. List them first and decide per ítem:

```sql
SELECT rs.preparacion_id, count(*) FROM fsj.reserva_stock rs
JOIN fsj.preparacion p ON p.tenant_id = rs.tenant_id AND p.id = rs.preparacion_id
WHERE p.estado = 'INICIADA' GROUP BY rs.preparacion_id;
```

Their preparaciones stay INICIADA after the rollback: they show as
"Confirmación en curso" and are confirmed (choosing partidas again) or
discarded from `/preparaciones/[id]`. Nothing in the libro or the stock
depends on a reserva, so nothing else is lost.

## Order

1. Deploy the reverted code **first** (it never reads `fsj.reserva_stock`;
   the table and the 0071 view are harmless to it -- the view only subtracts
   reservas that the old code no longer creates).
2. Copy `prisma/rollbacks/0071_reserva_stock.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and
   apply it with `npm run db:migrate`. Never edit or delete the applied 0071
   migration.
3. `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/preparaciones/application/liberar-reserva-stock.ts`
- `modules/preparaciones/application/confirmar-reserva-stock.ts`
- `modules/preparaciones/application/modificar-reserva-stock.ts`
- `modules/preparaciones/application/get-modificacion-de-reserva.ts`
- `modules/preparaciones/application/registrar-perdida-reserva.ts`
- `modules/preparaciones/application/list-dt-para-perdida.ts`
- `modules/preparaciones/domain/perdida.ts`
- `modules/preparaciones/ui/reserva-acciones.tsx`
- `docs/specs/reserva-stock-preparacion.md` and this file (optional)
- `prisma/migrations/20261008090000_0071_reserva_stock/` (keep it once applied; the down migration undoes it)

## Renamed file

- `modules/preparaciones/application/reservar-stock-preparacion.ts` → back to
  `confirmar-preparacion-de-ficha.ts` with its previous content
  (`confirmarPreparacionDeFicha`, create + confirm in one transaction).

## Edited files (revert the reserva hunks)

- `prisma/schema.prisma` (`ReservaStock` model).
- `modules/preparaciones/infrastructure/preparacion-repository.ts`
  (`reservadoPorOtrasSql` in `listPartidasElegiblesDroga`/`getPartidasFrescas`,
  reserva functions, `reservas`/`etiquetaGenerada` in the toma read).
- `modules/preparaciones/application/confirmar-preparacion.ts`
  (`planificarConsumoEnTx` extraction, `comoErrorDeDominio`, reserva deletion).
- `modules/preparaciones/application/{descartar-preparacion,generar-etiqueta,datos-confirmacion,get-preparacion-para-pantalla,get-toma-receta,get-confirmacion-de-ficha,iniciar-preparacion,partidas-para-pesar}.ts`.
- `modules/preparaciones/domain/toma.ts` (RESERVADA state, labels, cancel message).
- `modules/preparaciones/ui/{actions.ts,confirmar-form.tsx,continuar-preparacion-dialog.tsx,imprimir-etiqueta-dialog.tsx}`.
- `app/(app)/preparaciones/recetas/[recetaId]/page.tsx`.
- `modules/stock/application/registrar-ajuste.ts` (`registrarAjusteEnTx` extraction, reserva check),
  `modules/stock/application/verificar-co-firma-dt.ts` (`verificarCoFirmaDtEnTx`),
  `modules/stock/application/list-dt-para-co-firma.ts` (`listDtParaCoFirmaEnTx`),
  `modules/stock/infrastructure/partida-repository.ts` (`getReservadoEnPreparacion`, `insertAjuste` preparacionId).
  Pérdidas already registered keep their `movimiento_stock.preparacion_id` (immutable, valid without this code).
- Reserved-stock display: `modules/stock/application/get-partida.ts`, `modules/stock/ui/ajuste-form.tsx`,
  `modules/stock/infrastructure/valorizado-repository.ts`, `app/(app)/stock/partidas/page.tsx`,
  `app/(app)/stock/partidas/[id]/page.tsx`, `app/(app)/stock/ajustes/nuevo/page.tsx`,
  `app/(app)/reportes/stock-valorizado/page.tsx`, `app/api/stock/valorizado/export/csv/route.ts`
  (the CSV loses its last column `CantidadReservada`).
- `docs/specs/vencimiento-preparado.md` (R8 command name).
