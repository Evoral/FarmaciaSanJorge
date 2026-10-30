# Tasks — lotes-elaborados

Order matters: each block builds on the previous one. Design: `design.md`. Logic by this agent; UI (block 7) by the
agent the user picks, reviewed by this agent.

## 0. Decisions before starting

- [x] 0.1 Elaborated lots and diluciones are partidas of a droga (User decision 2026-10-29).
- [x] 0.2 No costo de proveedor, no price (R27 unchanged); initial pricing is out of scope (User decision 2026-10-29).
- [x] 0.3 D1 — no limit: exact precarga under the balance, offer a diluted lot or create one (User decision 2026-10-29).
- [x] 0.4 D2 — controlled drogas not limited; contralor asientos when the contralor is activated (User decision 2026-10-29).
- [x] 0.5 D3 — elaborated lots are not recorded in the libro recetario (User decision 2026-10-29).
- [ ] 0.6 Query: drogas whose unidad base is not g/mg/ml (design §5).

## 1. Schema (one migration)

- [x] 1.1 Migration `prisma/migrations/20261029130000_0111_lotes_elaborados/migration.sql`: enum values,
  `partida_proveedor_obligatorio` + `partida_elaborada_sin_compra`, `elaboracion_lote`,
  `movimiento_stock.elaboracion_lote_id` + CHECK, `formula_elaboracion` + `_componente` (INV-EL5),
  `elaboracion_lote_validar` (INV-EL1..EL4, deferred), `movimiento_stock_aplicar`, `partida_validar_ingreso_compra`,
  `v_stock_droga.stock_activo`, RLS via `setup_tenant_table`, grants.
- [x] 1.2 `prisma/schema.prisma` models/enums + `npm run db:generate`; labels (`enum-labels.ts`), `PartidaDetalle.origen`.
- [x] 1.3 `prisma/rollbacks/0111_lotes_elaborados.down.sql` and `docs/rollbacks/lotes-elaborados.md`.
- [x] 1.4 Permiso `stock.lote.elaborar` in `PERMISO_CATALOGO` (operativo), `PERMISOS_CON_PIN_CONFIGURABLES` (not in the
  default PIN set), `ayuda-permisos.ts`, plus its `fsj.permiso` row.
- [ ] 1.5 The user applies the migration (agents never apply migrations).

## 2. Domain (pure)

- [x] 2.1 `modules/stock/domain/elaboracion-lote.ts`: `potenciaDeDilucion`, `costoUnitarioDeLote`,
  `vencimientoMaximo`, `validarElaboracion`.
- [x] 2.2 `modules/drogas/domain/formula.ts`: `escalarFormula`, `validarFormula`.
- [x] 2.3 `modules/costos-proveedor/domain/costo-desde-formula.ts`: `costoDesdeFormula` (next to `costo-proveedor.ts`,
  where the costo domain lives).
- [x] 2.4 `modules/preparaciones/domain/pesada-real.ts`: `bajoLaBalanza`, `sugerenciaPesadaReal` (D1).
- [x] 2.5 Unit tests for 2.1–2.4: `tests/unit/lotes-elaborados-domain.test.ts`.

## 3. Stock: elaborar lote

- [x] 3.1 Repository: lock partidas, insert partida / `elaboracion_lote` / movements.
- [x] 3.2 `stock.lote.elaborar` command + `stock.lote.datos-para-elaborar` query. With the contralor active, refuse a
  controlled droga with a clear message (D2).
- [x] 3.3 Server Actions in `modules/stock/ui/actions.ts` (thin, `conOperador`), contracts only, no screens.
- [x] 3.4 Where a partida without proveedor shows `ETIQUETA_SIN_PROVEEDOR` ("Sin proveedor (existencia inicial)"), an
  ELABORACION_PROPIA one shows "Elaborado en farmacia": `partida-repository.ts` (3 mappers + 2 SQL),
  `historial-repository.ts` (2 SQL), `preparacion-repository.ts` (1 SQL).
- [x] 3.5 Movement tipo lists that enumerate tipos: `kardex-movimientos.ts`, `reporte-kardex.ts`,
  `proveedores/domain/trayectoria.ts` (a purchased partida consumed by an elaboración shows EGRESO_ELABORACION).

## 4. Fórmulas

- [x] 4.1 Repository + `drogas.formula.guardar` / `drogas.formula.ver`.

## 5. Precio desde fórmula

- [x] 5.1 `costos-proveedor-para-cotizar.ts`: fórmula fallback, `fuente: "FORMULA"` in the snapshot.
- [x] 5.2 R27 message names the materia prima without a costo.

## 6. Dosis bajo la balanza and stock activo

- [x] 6.1 `pesadaDeLinea` (`confirmar-form.tsx`) and the toma's pesaje use `sugerenciaPesadaReal` (exact precarga).
- [x] 6.2 `datos-confirmacion`: `bajoLaBalanza` and the droga's eligible diluted partidas per línea.
- [x] 6.3 Existencias read `stock_activo`; `alertas-stock.ts` compares `stock_activo`.

## 7. UI (built by this agent at the user's request, 2026-10-29)

- [x] 7.1 Partidas tab: origen label ("Elaborado en farmacia" / "Dilución N %"), filter by origen, detail with the
  consumed partidas.
- [x] 7.2 "Elaborar lote" dialog (`modules/stock/ui/elaborar-lote-dialog.tsx`, not the page `/partidas/elaborar`), opening from the Partidas header and a partida's "Diluir" (focuses that lot), with `use-form-submit` (keeps input on error).
- [x] 7.3 Fórmula editor in the droga's alta **and** edit form (edit offers what alta offers).
- [x] 7.4 Existencias: físico and activo columns.
- [x] 7.5 Pesaje: under the balance, a notice offering "usar lote diluido" / "crear dilución" (opens the dialog without leaving the pesaje, keeps everything typed, and on success the new diluted lot is chosen for that línea; button only shows with permiso `stock.lote.elaborar` / `DatosConfirmacion.puedeElaborarLote`, set by `get-confirmacion-de-ficha`, `get-preparacion-para-pantalla` and `get-recalculo-de-reserva`).
- [x] 7.6 Cotización detail (`cotizacion-detalle.tsx`) and presupuesto (`presupuesto-panel.tsx`): a `FORMULA` línea
  shows "costo desde su fórmula" with its components (`costoFormula`), never "costo de partidas"; its faltante is
  informational like a `PROVEEDOR` one.
- [ ] 7.7 Check in the browser once 0111 is applied (not possible before: the pages read the new table and column).

## 8. Close

- [ ] 8.1 Merge the deltas into `openspec/specs/` and archive the change.
