# Existencia inicial (relevamiento de stock al implementar)

Status: implemented 2026-10-23 (migration 0100). Rollback:
`docs/rollbacks/existencia-inicial.md`. Extends DP-21b (a new positive movement
type besides `INGRESO_COMPRA`). New invariants: INV-S24 (window), INV-S25
(origen ↔ ingreso type), INV-S26 (close once, by the DT).

## Goal

The day a pharmacy starts using the system it already has stock on its shelves.
After loading the drogas, it must **relevar** that stock: every physical envase
becomes a partida, so it can be consumed with lote, vencimiento and potencia like
any other (INV-S01: stock only exists as partidas; there is no stock number on the
droga).

Loading it as a purchase (`INGRESO_COMPRA`) would invent a proveedor and a
fecha de ingreso, pollute the proveedor trayectoria and, for a controlled droga,
demand a vale de adquisición (INV-L16) the pharmacy does not have. So existing
stock enters through its own door: a partida of origin **existencia inicial**,
allowed only while the tenant's **relevamiento inicial** is open.

## Vocabulary

- **Partida de existencia inicial**: a partida whose `origen = EXISTENCIA_INICIAL`,
  created from a physical envase counted during the relevamiento. Its only
  ingreso is an `INGRESO_INICIAL` movement.
- **Relevamiento inicial**: the tenant-level window during which partidas de
  existencia inicial can be created. **Abierto** or **cerrado**; once cerrado it
  never reopens.
- **Plazo del relevamiento**: `dias_relevamiento_inicial` (tenant parameter,
  default 30, **at most 90** -- three months) counted from the jornada of the
  tenant's **first signed cierre diario**.

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | `partida.origen` is `COMPRA` (default, every partida today) or `EXISTENCIA_INICIAL`. Insert-only. A partida de existencia inicial has exactly one ingreso, of type `INGRESO_INICIAL`; a `COMPRA` partida keeps `INGRESO_COMPRA`. The DB refuses a mismatch. | New enum `origen_partida`, column `partida.origen`; enum value `tipo_movimiento.INGRESO_INICIAL`; `fsj.movimiento_stock_aplicar` (the DP-21b sign check: only `INGRESO_COMPRA` and `INGRESO_INICIAL` add saldo, one ingreso per partida). |
| R2 | A partida de existencia inicial can be created only while the relevamiento is **abierto** (R6). Purchases (`INGRESO_COMPRA`, manual or from a factura PDF) are allowed at any time, before, during and after the relevamiento. | App: the new use case (R4). DB: insert trigger on `partida` re-checks the window for `origen = EXISTENCIA_INICIAL`. |
| R3 | Data of a partida de existencia inicial, read from the physical envase: droga, **lote** (required), **fecha de vencimiento** (required for a `DROGA`, optional for an insumo, same as today, trg_partida_validar_vencimiento), **cantidad** counted (required, > 0, in the droga's unidad base), **potencia declarada** (same rule as a purchase: required when the droga demands it), **costo unitario** (required, ≥ 0; prefilled with the droga's vigente costo de proveedor when there is one, `modules/costos-proveedor`), **proveedor** (optional). | zod schema of the use case; DB checks. |
| R4 | Proveedor is nullable **only** for `origen = EXISTENCIA_INICIAL` (check `proveedor_id IS NOT NULL OR origen = 'EXISTENCIA_INICIAL'`). Uniqueness without proveedor: one partida per `(tenant, droga, lote)` among those with NULL proveedor (partial unique index), alongside today's `(tenant, droga, proveedor, lote)`. | Migration. Every read that assumes `partida.proveedor` exists (Prisma type becomes optional) shows "Sin proveedor (existencia inicial)". |
| R5 | Creating one is a `defineCommand` use case, permiso `stock.partida.ingresar` (same as a manual alta, PIN-configurable: `conOperador`), audited (`partida`, CREAR, with `origen`), running the manual alta's own rules (`registrarPartidaCompra` with `origen`). Its UI is an "Existencia inicial" panel at the top of `/partidas/ingresar`, shown only while the relevamiento is abierto: one envase per submit (the manual alta is an invoice of several lotes, which existing stock does not have); it keeps every field on error and clears them on success for the next envase. | `modules/stock/application/ingresar-existencia-inicial.ts`, `modules/stock/ui/existencia-inicial-form.tsx`, `relevamiento-inicial-panel.tsx`. |
| R6 | The relevamiento is **abierto** when it has not been closed by the DT **and** the plazo has not run out: no signed cierre yet, or jornada actual ≤ jornada of the first signed cierre + `dias_relevamiento_inicial`. Computed, not a job: nothing runs when the plazo ends, altas are simply refused from then on. The plazo can never exceed **three months (90 days)** from the first signed cierre, so the feature cannot be kept open to bring stock in without a purchase: the parametro accepts 1-90, and the DB caps whatever value it reads at 90. Raising the parametro after the plazo ran out re-enables the alta up to the new date (still within the 90 days); a DT close never reopens. | Domain function `relevamientoAbierto(...)` (pure); DB function used by the R2 trigger. |
| R7 | **Cerrar relevamiento**: only the **DT vigente**, themselves, confirming with their own password (same pattern as the reanálisis, `verificarPasswordDtPartidaCommand`). Irreversible (`tenant.relevamiento_inicial_cerrado_en` / `_por_id`, set once, no reopen). Audited (`tenant`, MODIFICAR, with the number of drogas and partidas loaded). The panel shows, before confirming, how many envases and drogas were loaded. | App: permiso `stock.ajuste.autorizar` + `esDtVigenteHoy`. DB: the two columns are write-once. |
| R8 | **Controlled drogas, contralor digital activo** (`tenant.fecha_activacion_contralor` not NULL): an `INGRESO_INICIAL` **never** generates a contralor asiento; the droga's `APERTURA` asiento (INV-L15, saldo of the manual libro) already accounts for that physical stock. Closing the relevamiento (R7) is **refused** while, for any controlled droga, the contralor saldo (latest vigente asiento's `saldo_posterior`) differs from its physical stock (sum of `cantidad_disponible` of all its partidas); the refusal lists each droga with both figures. With the contralor manual (paper), no check. | Contralor asiento trigger (skip `INGRESO_INICIAL`); the close use case. |
| R9 | An envase that was **already open** at the relevamiento gets no special mark: `fecha_apertura` stays NULL and is set by its first `EGRESO_PREPARACION`, as for any partida (INV-S16/S17). Consequence: when the farmacéutico overrides the proposed split (INV-S15), INV-S18 may ask for a motivo de apertura adicional on an envase that was physically open already; the motivo can say so. | No change. |
| R10 | Reports distinguish the origin: the kardex labels the movement "Existencia inicial"; the stock valorizado includes these partidas (they have costo); the proveedor trayectoria and purchase-based views list only partidas with a proveedor; the partida detail shows "Origen: existencia inicial". | `kardex-movimientos.ts`, `reporte-valorizado.ts`, `trayectoria-repository.ts`, `/partidas/[id]`. |
| R11 | After the relevamiento closes, differences follow today's rules: a faltante is an `AJUSTE DIFERENCIA_ARQUEO` with DT authorization (S21); a sobrante follows DP-21b. Existencia inicial is never the way to fix them. | No change. |
| R12 | **Controlled droga given alta with the contralor digital activo**: the alta requires the **saldo de apertura** (≥ 0, in the droga's unidad base): what the manual libro shows for that droga, 0 if the pharmacy never had it. The same transaction writes its `APERTURA` asiento (INV-L15) in the libro its `tipo_control` maps to. Editing a droga **into** controlada with the contralor activo asks for the same saldo (the edit offers what the alta offers). Without it, the DB rejects every later movement of the droga (no APERTURA yet, migration 0018) and R8 has no saldo to compare. With the contralor manual, the field is not shown. | `modules/drogas` alta/edit use cases + the shared droga form; the contralor repository inserts the APERTURA inside the use case's tenant transaction. |

## Decisions

- **Partidas, not a stock number.** Every egreso consumes a partida and the libro
  recetario prints its lote; FEFO, INV-S10 (vencimiento vigente), potencia and the
  valorizado all read the partida. A per-droga "stock inicial" could not be
  consumed without inventing those fields later.
- **Own origin and movement type, not `INGRESO_COMPRA`.** A purchase carries a
  proveedor, a factura and (controlled) a vale; existing stock has none of them.
  Keeping them apart keeps purchase reports and the proveedor trayectoria true,
  and lets the DB enforce the window on exactly these rows.
- **A window that closes, by the DT or by the plazo.** Existencia inicial is the
  only way stock enters without a purchase; left open, it becomes the way to hide
  differences (and, for controlled drogas, a regulatory problem). The explicit
  close is the auditable act; the plazo is the safety net if nobody closes it.
  Anchoring the plazo to the first signed cierre follows the libro numeración
  rule (fixed by the first signed cierre, migration 0097) and lets a large
  relevamiento span several days of real operation.
- **Controlled check at close, on current figures.** Comparing the contralor saldo
  with today's physical stock holds no matter how many preparaciones ran during the
  relevamiento: every movement after activation already wrote its asiento.
- **Already-open envases: no mark.** Tracking "opened before the system" adds a
  field and a UI choice for a case that only matters to INV-S18's motivo prompt.

## Implementation notes

- **No app path activates the contralor digital yet.** `tenant.fecha_activacion_contralor` is never written by
  the app, and no APERTURA was written before R12. R8 and R12 are implemented and take effect once the contralor
  is activated (today, only by SQL); with it NULL the relevamiento ignores the contralor entirely. Related gap,
  out of scope here: with the contralor activo, an `INGRESO_COMPRA` of a controlled droga requires a contralor
  asiento (INV-L08) that the purchase alta does not write.
- **Partidas without proveedor in reads.** Every raw query that joined `fsj.proveedor` with an inner JOIN now uses
  a LEFT JOIN and shows `ETIQUETA_SIN_PROVEEDOR`; in particular the preparación's eligible partidas, which would
  otherwise never offer a partida de existencia inicial.

## Open points

- **Resolved 2026-10-23 — controlled droga given alta after the activation.**
  Its alta asks for the saldo de apertura of the manual libro and writes the
  `APERTURA` (R12). No automatic saldo-0 APERTURA: a droga the pharmacy already
  held would start the libro with a wrong saldo. Also resolves the libro spec's
  PENDIENTE on the same question.
- **Resolved 2026-10-23 — existing tenants.** Each tenant has its own plazo
  (R6, from its own first signed cierre). No backfill: a tenant already operating
  for more than the plazo simply sees its relevamiento cerrado, with no DT close
  recorded.
