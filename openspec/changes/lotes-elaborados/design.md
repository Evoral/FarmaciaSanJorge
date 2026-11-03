# Design — lotes-elaborados

Proposal: `proposal.md`. Delta specs: `specs/elaboracion-lote`, `specs/pesada-real`, `specs/costos-proveedor`.

## 1. Model: an elaborated lot is a partida

The purity engine (migration 0058; `modules/preparaciones/domain/potencia.ts`, R25, INV-S12) already handles several
partidas of one droga with different `potencia_declarada`. A dilución of droga X at 1 % is a partida of X with
`potencia_declarada = 1`: recetas, fichas, the split, the lot choice and INV-S12 need no change. A separate droga or
category would force every receta to reference "X 1 %" and lose the active-ingredient equivalence.

Precedent: migration 0100 (`existencia_inicial`) added an `origen`, a proveedor-less partida and a new ingreso type.
This change follows it point by point.

## 2. Schema (one migration, number re-checked before applying; 0110 is the latest today)

| Object | Change |
|---|---|
| `fsj.origen_partida` | `ADD VALUE 'ELABORACION_PROPIA'` |
| `fsj.tipo_movimiento` | `ADD VALUE 'INGRESO_ELABORACION'`, `'EGRESO_ELABORACION'` |
| `fsj.partida` | `partida_proveedor_obligatorio`: proveedor NULL also for `ELABORACION_PROPIA`. Lote uniqueness: `uq_partida_lote_sin_proveedor` (0100) already covers every NULL-proveedor row, re-check its predicate. |
| `fsj.elaboracion_lote` (new) | `id, tenant_id, partida_id` (the produced one, UNIQUE; its `cantidad_inicial` is the cantidad producida), `tipo` (`DILUCION` / `FORMULA`), `formula_id` (NULL for DILUCION), `elaborado_por_id`, `registrado_en`, `observacion`. Immutable (`forbid_update_delete`, no UPDATE/DELETE grant), `assert_actor_activo`. |
| `fsj.movimiento_stock` | `elaboracion_lote_id uuid` (composite FK). CHECK: NOT NULL iff `tipo IN ('INGRESO_ELABORACION','EGRESO_ELABORACION')`. |
| `fsj.formula_elaboracion` (new) | `id, tenant_id, droga_id` (UNIQUE per tenant), `cantidad_referencia > 0` (the droga's unidad base), `actualizada_por_id`, `actualizada_en`. |
| `fsj.formula_elaboracion_componente` (new) | `formula_id, orden, droga_id, cantidad > 0` (the component's unidad base, like `insumo_preparacion`); UNIQUE `(formula_id, droga_id)`; INV-EL5 trigger (one level, not itself). |
| `fsj.v_stock_droga` | adds `stock_activo = Σ cantidad_disponible × coalesce(potencia_declarada, 100) / 100` (same non-expired filter as 0074). |

Enum values added in the same transaction are referenced only inside plpgsql bodies or as `::text`, never in a
constraint or index predicate created in that transaction (the 0100 rule). The CHECK on `movimiento_stock` compares
`tipo::text`.

### Triggers and functions

- `movimiento_stock_aplicar` (latest body 0100): `INGRESO_ELABORACION` adds. `EGRESO_ELABORACION` subtracts, is refused
  on an expired partida (INV-S10, like `EGRESO_PREPARACION`) and sets `fecha_apertura` (INV-S16/S17).
- `partida_validar_ingreso_compra` (INV-STK-002 / INV-S25, latest 0100): `ELABORACION_PROPIA` requires exactly one
  `INGRESO_ELABORACION` equal to `cantidad_inicial`.
- New deferred constraint trigger `elaboracion_lote_validar` (INV-EL1..EL3, see the spec): at least one egreso; a
  DILUCION's produced partida has the same droga as one of its egresos and its active equals the active consumed of
  that droga (tolerance 10^-4, the INV-S12 tolerance); no egreso from the produced partida itself.
- Controlled drogas (D2): no guard. `movimiento_stock_validar_contralor` (INV-L08) is unchanged: it only fires once the
  tenant activates the contralor (no tenant has, 2026-10-29). From then on an elaboration movement on a controlled
  droga needs its asiento; until those asientos are defined, `stock.lote.elaborar` refuses it up front with a clear
  message instead of the raw INV-L08 error.
- `movimiento_stock_validar_jornada_abierta` (0015) already applies to every movement: elaborating needs an open
  jornada.

## 3. Domain (pure)

`modules/stock/domain/elaboracion-lote.ts`:

- `potenciaDeDilucion(consumosDeLaDroga, cantidadProducida)`: `Σ(cantidad × potenciaEfectiva) / cantidadProducida`,
  rounded **down** to `DECIMALES_POTENCIA` (declaring more potency than real would under-dose). Must stay `> 0` and
  `≤ 100`.
- `costoUnitarioDeLote(consumos, cantidadProducida)`: `Σ(cantidad × costo_unitario de su partida) / cantidadProducida`.
  Quantities in each droga's unidad base; the result is per the produced droga's unidad base.
- `vencimientoMaximo(partidasConsumidas)`: the minimum `fecha_vencimiento_vigente` among those that have one; `null`
  when none expires (only valid for a non-DROGA produced droga, enforced by `trg_partida_validar_vencimiento`, 0064).
- `validarElaboracion(...)`: at least one component, quantities > 0, same magnitud as each droga's stock, no expired
  partida, the produced droga is not among the components of a FORMULA lot, and the requested vencimiento is
  `≤ vencimientoMaximo`.

`modules/drogas/domain/formula.ts`:

- `escalarFormula(formula, cantidad)`: the components for `cantidad` of the product (precarga of "Elaborar lote").
- `validarFormula(...)`: one level (no component has its own fórmula), no repeated component, not itself.

`modules/costos-proveedor/domain/costo-desde-formula.ts` (next to `costo-proveedor.ts`):

- `costoDesdeFormula(formula, costosVigentes)`: `Σ componente × costo de proveedor del componente / cantidad_referencia`,
  in the produced droga's unidad base. A component without a usable costo → `{ ok: false, sinCosto: drogaNombre }`.

`modules/preparaciones/domain/pesada-real.ts` (D1, no limit):

- `bajoLaBalanza(esperadaFisica, precision)`: `true` when the expected physical weight is below one balance division.
- `sugerenciaPesadaReal(esperadaFisica, precision)`: the balance-rounded value as today, or the EXACT esperada when
  `bajoLaBalanza` (today it rounds to 0 and the server refuses it). P3 is unchanged.

## 4. Application (use cases, `defineCommand` / `defineQuery`)

| Use case | Module | Permiso | Notes |
|---|---|---|---|
| `stock.lote.elaborar` | stock | `stock.lote.elaborar` (new, operativo, in `PERMISOS_CON_PIN_CONFIGURABLES`) | Locks the consumed partidas (`FOR UPDATE`, same order as reserva), inserts partida + `elaboracion_lote` + egresos + ingreso in one tenant transaction. Reserved stock is not available (same availability as the reserva). The Server Action wraps in `conOperador`. |
| `stock.lote.datos-para-elaborar` | stock | `stock.lote.elaborar` | For a droga (dilución) or a fórmula scaled to a quantity: eligible partidas per component in consumption order, `vencimientoMaximo`, the computed potencia/costo preview. |
| `drogas.crear` / `drogas.editar` (+ `drogas.formula.guardar`) | drogas | as each | The fórmula is saved with the droga's alta/edit form in the same transaction (`aplicarFormulaEnTx`), audited as its own `formula_elaboracion` row; `formula: null` removes it (refused once used in an elaboración). |
| `drogas.formula.ver` | drogas | `drogas.ver` (or the current read permiso of drogas) | |
| cotización | precios | unchanged | `costos-proveedor-para-cotizar.ts`: a droga without a usable costo de proveedor but with a fórmula is costed by `costoDesdeFormula`; the snapshot records `fuente: "FORMULA"`. |
| confirmar / reservar | preparaciones | unchanged | No new check (D1). `datos-confirmacion` exposes per línea `bajoLaBalanza` (the dose itself is below one division) and flags each eligible partida `esDilucion` (elaborated as a DILUCION; a bought lot at 98 % is not a dilución), so the form offers "usar lote diluido" (select it) or "crear dilución" (opens the `elaborar-lote-dialog.tsx` dialog without leaving the pesaje, keeps everything typed, and on success the new diluted lot is chosen for that línea; the button only shows with permiso `stock.lote.elaborar` / `DatosConfirmacion.puedeElaborarLote`, set by `get-confirmacion-de-ficha`, `get-preparacion-para-pantalla` and `get-recalculo-de-reserva`). |
| existencias | stock | unchanged | Reads `stock_activo` from `v_stock_droga`; `alertas-stock.ts` compares `stock_activo` with `stock_minimo`. |

Contracts for the UI agent: input/output types of the three use cases plus `bajoLaBalanza` and the diluted partidas
per línea in `DatosConfirmacion`.

## 5. Risks

- **INV-S12 with diluted lots**: unchanged math. A dilución at 0,1 % multiplies the physical weight by 1000, and
  `fisicoParaActivo` rounds up to 4 decimals in the droga's unidad base, which is fine for g/mg bases. A droga with a
  kg base would round to 0,1 g: check with a DB query before applying and refuse a dilución of a kg-based droga if any
  exists.
- **Unique lote**: two elaborations the same day need distinct lote codes. The app suggests `E-<yyyymmdd>-<n>`.
- **Concurrency**: elaborating and reserving the same partida. Both lock the partida rows; the second one sees the new
  balance.
- **Rollback**: the new partidas and movements are facts (the stock really moved). The `.down.sql` drops the new tables
  and columns only when there are no `ELABORACION_PROPIA` partidas; otherwise rollback is "disable the permiso".
