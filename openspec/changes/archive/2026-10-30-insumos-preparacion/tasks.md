# Tasks — insumos-preparacion

Design: `design.md`.

## 1. Schema (one migration)

- [x] 1.1 `prisma/migrations/20261029120000_0110_insumos_preparacion/migration.sql`: `fsj.tipo_insumo`, `fsj.insumo_preparacion` (+ trigger, partial unique), relaxed 0092 triggers, `fsj.insumo_borrador` (DELETE grant).
- [x] 1.2 `prisma/schema.prisma` (`TipoInsumo`, `InsumoPreparacion`, `InsumoBorrador`) + `npm run db:generate`.
- [x] 1.3 `prisma/rollbacks/0110_insumos_preparacion.down.sql` and `docs/rollbacks/insumos-preparacion.md`.
- [ ] 1.4 User applies 0110 by hand, in the same deploy as the code.

## 2. Domain and application

- [x] 2.1 `domain/insumo.ts`: clase admitted per tipo, repeated droga, cápsulas pre-fill, text.
- [x] 2.2 Repository: línea-less rows scoped by droga; insumo draft / preparación / options / ítem forma functions; toma data `insumos`; fórmula `adicionales`.
- [x] 2.3 `excipiente-preparacion.ts` switched to the droga-scoped functions; `planificarSinLinea` exported.
- [x] 2.4 `insumos-preparacion.ts`: validate, reserve, re-plan, save re-plan, consume, candidates.
- [x] 2.5 `guardar-insumos-borrador.ts`; `guardar-excipiente-borrador.ts` refuses a droga already used as insumo.
- [x] 2.6 Wire `reservarStock`, `recalcularReservaStock`, `registrarPerdidaReserva`, `confirmarPreparacionEnTx`, `confirmarReservasReceta` (lock).
- [x] 2.7 `get-confirmacion-de-ficha.ts` / `datos-confirmacion.ts`: options, draft, cápsulas.

## 3. UI

- [x] 3.1 `ui/actions.ts`: `guardarInsumosBorradorAction`, `insumos` in `reservarStockAction`.
- [x] 3.2 `ui/pesaje-en-toma.tsx`: Material row, adicional rows, "Agregar insumo", hidden save form, dialog second chance and blocking, reserva fields.
- [x] 3.3 Toma page: "Material utilizado" / "Insumos adicionales" read-only.

## 4. Specs and checks

- [x] 4.1 `openspec/specs/insumos-preparacion/spec.md` (I1-I12); E7 of `excipiente-preparacion` modified; `npm run specs:validate`.
- [x] 4.2 `npm run typecheck`, `npm run lint`; unit test mocks updated for the new repository functions; `insumos` field label.
- [ ] 4.3 Manual check in the app after 0110 is applied (cápsulas ítem, adicional, recalcular, pérdida, imprimir etiquetas, libro fórmula).
- [x] 4.4 Archive the change (`changes/archive/YYYY-MM-DD-insumos-preparacion/`) WITHOUT merging specs (`openspec archive insumos-preparacion --skip-specs`): the main specs are already merged.
