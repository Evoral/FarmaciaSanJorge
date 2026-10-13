# Rollback: Reanálisis de partida

Spec: `docs/specs/reanalisis-partida.md`. The feature has a **schema change**
(migration `prisma/migrations/20261012090000_0074_reanalisis_partida`), so it is
reverted as code + a new forward migration built from
`prisma/rollbacks/0074_reanalisis_partida.down.sql`.

## What the down migration loses

- Every reanálisis (`fsj.reanalisis_partida`) and `partida.fecha_vencimiento_vigente`.
  A re-analysed partida goes back to its **original** `fecha_vencimiento`: if that
  date already passed it is blocked again (INV-S10) and shows as "vencida con
  saldo"; zero it with a VENCIMIENTO ajuste or ingress the lot again.
- INV-S22 / INV-S23 disappear. `partida_validar_update` goes back to its 0008
  body, `movimiento_stock_aplicar` to its 0014 body, `v_stock_droga` to its 0071
  body (all reading `fecha_vencimiento`).
- Not lost: the VENCIMIENTO ajustes registered by "marcar como vencida" are
  ordinary `movimiento_stock` rows and stay.

Export the history first if it must be kept (the audit records stay anyway):

```sql
SELECT r.*, p.lote FROM fsj.reanalisis_partida r JOIN fsj.partida p ON p.tenant_id = r.tenant_id AND p.id = r.partida_id ORDER BY r.registrado_en;
```

## Order

1. Deploy the reverted code **first**: it reads only `fecha_vencimiento`, which
   still exists. Dropping `fecha_vencimiento_vigente` while the current code is
   live makes every stock read fail (`column "fecha_vencimiento_vigente" does
   not exist`).
2. Copy `prisma/rollbacks/0074_reanalisis_partida.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and
   apply it with `npm run db:migrate`. Never edit or delete the applied 0074
   migration.
3. `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/stock/domain/vencimiento-partida.ts`
- `modules/stock/application/reanalizar-partida.ts`
- `modules/stock/application/marcar-partida-vencida.ts`
- `modules/stock/application/verificar-password-dt-partida.ts`
- `modules/stock/application/dias-alerta-vencimiento.ts`
- `modules/stock/ui/acciones-dt-partida.tsx`
- `docs/specs/reanalisis-partida.md` and this file (optional)
- `prisma/migrations/20261012090000_0074_reanalisis_partida/` (keep it once applied; the down migration undoes it)

## Edited files (revert the reanálisis hunks)

- `prisma/schema.prisma`: `fechaVencimientoVigente` in `model Partida`, `model ReanalisisPartida`.
- `modules/stock/infrastructure/partida-repository.ts`: `fecha_vencimiento_vigente` in the `/stock` list, `listPartidasDeDroga`, `getPartidaParaAccion` (`drogaClase`, `fechaVencimientoVigente`), the alerts (`esDroga`, `reanalizada`), `insertReanalisis`, `listReanalisisDePartida`.
- `modules/stock/infrastructure/valorizado-repository.ts`, `modules/precios/infrastructure/cotizacion-repository.ts`, `modules/proveedores/infrastructure/trayectoria-repository.ts` (+ the comment in `modules/proveedores/domain/trayectoria.ts`): back to `fecha_vencimiento`.
- `modules/stock/application/get-partida.ts`, `list-partidas-droga.ts`; `modules/stock/domain/reparto.ts` (comments); `modules/stock/ui/actions.ts` (the two actions).
- `modules/preparaciones/infrastructure/preparacion-repository.ts` (`fecha_vencimiento_vigente`, `reanalizada`, the reserva's `fechaVencimiento`), `application/partidas-para-pesar.ts`, `datos-confirmacion.ts` (`diasAlertaVencimiento`), `get-toma-receta.ts`, `confirmar-preparacion.ts` (message), `ui/confirmar-form.tsx`, `ui/lineas-ficha-tabla.tsx`.
- `app/(app)/page.tsx`, `app/(app)/stock/page.tsx`, `app/(app)/stock/partidas/page.tsx`, `app/(app)/stock/partidas/[id]/page.tsx`, `app/(app)/stock/ajustes/nuevo/page.tsx`, `app/(app)/preparaciones/recetas/[recetaId]/page.tsx`.
- `shared/errors/mensajes-invariantes.ts`: `INV-S10` text; keep `INV-S22`/`INV-S23` while the 0074 migration file exists (the global-messages test scans every migration).
- `shared/labels/field-labels.ts`: the reanálisis labels.
