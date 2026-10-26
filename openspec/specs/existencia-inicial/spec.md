# Existencia inicial (relevamiento de stock al implementar)

## Purpose

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

Implemented 2026-10-23 (see Status).

## Requirements

### Requirement: R1 — Origen and ingreso type

`partida.origen` SHALL be `COMPRA` (default, every partida today) or `EXISTENCIA_INICIAL`. Insert-only. A partida
de existencia inicial has exactly one ingreso, of type `INGRESO_INICIAL`; a `COMPRA` partida keeps
`INGRESO_COMPRA`. The DB refuses a mismatch.

#### Scenario: Partida inserted without origen

- **WHEN** a partida is inserted without `origen`
- **THEN** its `origen` is `COMPRA`

#### Scenario: Ingreso of the other type

- **GIVEN** a partida with `origen = EXISTENCIA_INICIAL`
- **WHEN** an `INGRESO_COMPRA` movement is applied to it
- **THEN** the DB refuses it

#### Scenario: Second ingreso

- **GIVEN** a partida de existencia inicial with its `INGRESO_INICIAL`
- **WHEN** another ingreso is applied to it
- **THEN** the DB refuses it

### Requirement: R2 — Only while the relevamiento is abierto

A partida de existencia inicial SHALL be created only while the relevamiento is **abierto** (R6). Purchases
(`INGRESO_COMPRA`, manual or from a factura PDF) are allowed at any time, before, during and after the
relevamiento.

#### Scenario: Alta with the relevamiento cerrado

- **GIVEN** the tenant's relevamiento inicial is cerrado
- **WHEN** a user tries to create a partida de existencia inicial
- **THEN** it is refused

#### Scenario: Insert that skips the app

- **GIVEN** the tenant's relevamiento inicial is cerrado
- **WHEN** a partida with `origen = EXISTENCIA_INICIAL` is inserted directly
- **THEN** the insert trigger on `partida` refuses it

#### Scenario: Purchase after the relevamiento

- **GIVEN** the tenant's relevamiento inicial is cerrado
- **WHEN** a user registers an `INGRESO_COMPRA`, manual or from a factura PDF
- **THEN** the purchase is allowed

### Requirement: R3 — Data read from the envase

The data of a partida de existencia inicial SHALL be read from the physical envase: droga, **lote** (required),
**fecha de vencimiento** (required for a `DROGA`, optional for an insumo, same as today,
trg_partida_validar_vencimiento), **cantidad** counted (required, > 0, in the droga's unidad base), **potencia
declarada** (same rule as a purchase: required when the droga demands it).

#### Scenario: Cantidad zero

- **WHEN** an envase is loaded with cantidad 0
- **THEN** it is refused

#### Scenario: DROGA without fecha de vencimiento

- **GIVEN** a droga whose `clase` is `DROGA`
- **WHEN** an envase of it is loaded without fecha de vencimiento
- **THEN** it is refused

#### Scenario: Insumo without fecha de vencimiento

- **GIVEN** an insumo
- **WHEN** an envase of it is loaded without fecha de vencimiento
- **THEN** the partida can be created

### Requirement: R3 — Costo unitario and proveedor

The data of a partida de existencia inicial SHALL also include **costo unitario** (required, ≥ 0; prefilled with
the droga's vigente costo de proveedor when there is one, `modules/costos-proveedor`) and **proveedor**
(optional).

#### Scenario: Droga with a vigente costo de proveedor

- **GIVEN** a droga with a vigente costo de proveedor
- **WHEN** the user loads an envase of it
- **THEN** the costo unitario is prefilled with that costo

#### Scenario: Negative costo unitario

- **WHEN** an envase is loaded with a costo unitario below 0
- **THEN** it is refused

#### Scenario: Envase without proveedor

- **WHEN** an envase is loaded without a proveedor
- **THEN** the partida can be created

### Requirement: R4 — Proveedor nullable only for existencia inicial

Proveedor SHALL be nullable **only** for `origen = EXISTENCIA_INICIAL` (check `proveedor_id IS NOT NULL OR origen =
'EXISTENCIA_INICIAL'`). Uniqueness without proveedor: one partida per `(tenant, droga, lote)` among those with
NULL proveedor (partial unique index), alongside today's `(tenant, droga, proveedor, lote)`.

#### Scenario: COMPRA partida without proveedor

- **WHEN** a partida with `origen = COMPRA` is inserted with no proveedor
- **THEN** the DB check refuses it

#### Scenario: Same lote twice without proveedor

- **GIVEN** a partida with NULL proveedor for a droga and lote
- **WHEN** another partida with NULL proveedor is inserted for the same droga and lote
- **THEN** the partial unique index refuses it

#### Scenario: Partida without proveedor in a read

- **GIVEN** a partida de existencia inicial without proveedor
- **WHEN** a read that shows `partida.proveedor` lists it
- **THEN** it shows "Sin proveedor (existencia inicial)"

### Requirement: R5 — Use case

Creating one SHALL be a `defineCommand` use case, permiso `stock.partida.ingresar` (same as a manual alta,
PIN-configurable: `conOperador`), audited (`partida`, CREAR, with `origen`), running the manual alta's own rules
(`registrarPartidaCompra` with `origen`).

#### Scenario: Envase loaded

- **GIVEN** a user with the permiso `stock.partida.ingresar` and the relevamiento abierto
- **WHEN** the user loads an envase
- **THEN** the partida is created through `registrarPartidaCompra` with `origen`
- **AND** it is audited as `partida`, CREAR, with `origen`

#### Scenario: User without the permiso

- **GIVEN** a user without the permiso `stock.partida.ingresar`
- **WHEN** the user tries to load an envase
- **THEN** it is refused

### Requirement: R5 — Existencia inicial panel

Its UI SHALL be an "Existencia inicial" panel at the top of `/partidas/ingresar`, shown only while the
relevamiento is abierto: one envase per submit (the manual alta is an invoice of several lotes, which existing
stock does not have); it keeps every field on error and clears them on success for the next envase.

#### Scenario: Relevamiento abierto

- **GIVEN** the relevamiento is abierto
- **WHEN** a user opens `/partidas/ingresar`
- **THEN** the "Existencia inicial" panel is shown at the top

#### Scenario: Relevamiento cerrado

- **GIVEN** the relevamiento is cerrado
- **WHEN** a user opens `/partidas/ingresar`
- **THEN** the "Existencia inicial" panel is not shown

#### Scenario: Submit with an error

- **WHEN** the user submits an envase and the alta fails
- **THEN** every field keeps what the user entered

#### Scenario: Submit that succeeds

- **WHEN** the user submits an envase and the alta succeeds
- **THEN** the fields are cleared for the next envase

### Requirement: R6 — When the relevamiento is abierto

The relevamiento SHALL be **abierto** when it has not been closed by the DT **and** the plazo has not run out: no
signed cierre yet, or jornada actual ≤ jornada of the first signed cierre + `dias_relevamiento_inicial`. Computed,
not a job: nothing runs when the plazo ends, altas are simply refused from then on.

#### Scenario: No signed cierre yet

- **GIVEN** a tenant with no signed cierre diario and a relevamiento not closed by the DT
- **WHEN** the relevamiento is evaluated
- **THEN** it is abierto

#### Scenario: Last day of the plazo

- **GIVEN** the first signed cierre on jornada 2026-10-01, `dias_relevamiento_inicial` = 30 and no DT close
- **WHEN** the jornada actual is 2026-10-31
- **THEN** the relevamiento is abierto

#### Scenario: Day after the plazo

- **GIVEN** the first signed cierre on jornada 2026-10-01, `dias_relevamiento_inicial` = 30 and no DT close
- **WHEN** the jornada actual is 2026-11-01
- **THEN** the relevamiento is cerrado and an alta de existencia inicial is refused
- **AND** nothing ran when the plazo ended

### Requirement: R6 — Plazo capped at three months

The plazo MUST never exceed **three months (90 days)** from the first signed cierre, so the feature cannot be kept
open to bring stock in without a purchase: the parametro accepts 1-90, and the DB caps whatever value it reads at
90.

#### Scenario: Parametro above 90

- **WHEN** a user sets `dias_relevamiento_inicial` to 91
- **THEN** the value is refused

#### Scenario: Stored value above 90

- **GIVEN** a `dias_relevamiento_inicial` above 90 stored for the tenant
- **WHEN** the DB computes the plazo
- **THEN** it uses 90

### Requirement: R6 — Raising the parametro

Raising the parametro after the plazo ran out SHALL re-enable the alta up to the new date (still within the 90
days); a DT close never reopens.

#### Scenario: Plazo ran out, parametro raised

- **GIVEN** a relevamiento cerrado because its plazo ran out, not closed by the DT
- **WHEN** the parametro is raised so that the new date is on or after the jornada actual, within the 90 days
- **THEN** the alta de existencia inicial is allowed again up to the new date

#### Scenario: Closed by the DT, parametro raised

- **GIVEN** a relevamiento closed by the DT
- **WHEN** the parametro is raised
- **THEN** the relevamiento stays cerrado

### Requirement: R7 — Cerrar relevamiento

**Cerrar relevamiento** SHALL be done only by the **DT vigente**, themselves, confirming with their own password
(same pattern as the reanálisis, `verificarPasswordDtPartidaCommand`). Irreversible
(`tenant.relevamiento_inicial_cerrado_en` / `_por_id`, set once, no reopen). Audited (`tenant`, MODIFICAR, with
the number of drogas and partidas loaded). The panel shows, before confirming, how many envases and drogas were
loaded.

#### Scenario: The DT closes the relevamiento

- **GIVEN** the DT vigente, with the permiso `stock.ajuste.autorizar`, and the relevamiento abierto
- **WHEN** the DT confirms the close with their own password
- **THEN** `tenant.relevamiento_inicial_cerrado_en` / `_por_id` are set
- **AND** it is audited as `tenant`, MODIFICAR, with the number of drogas and partidas loaded

#### Scenario: Before confirming

- **GIVEN** the DT vigente and the relevamiento abierto
- **WHEN** the DT opens the close in the panel
- **THEN** the panel shows how many envases and drogas were loaded

#### Scenario: A user who is not the DT vigente

- **GIVEN** a user who is not the DT vigente
- **WHEN** the user tries to close the relevamiento
- **THEN** it is refused

#### Scenario: Reopening a closed relevamiento

- **GIVEN** a relevamiento closed by the DT
- **WHEN** `tenant.relevamiento_inicial_cerrado_en` or `_por_id` is written again
- **THEN** the DB refuses it

### Requirement: R8 — No contralor asiento for an INGRESO_INICIAL

**Controlled drogas, contralor digital activo** (`tenant.fecha_activacion_contralor` not NULL): an
`INGRESO_INICIAL` MUST **never** generate a contralor asiento; the droga's `APERTURA` asiento (INV-L15, saldo of
the manual libro) already accounts for that physical stock.

#### Scenario: Existencia inicial of a controlled droga

- **GIVEN** the contralor digital activo and a controlled droga
- **WHEN** a partida de existencia inicial of that droga is created
- **THEN** its `INGRESO_INICIAL` generates no contralor asiento

### Requirement: R8 — Close refused while contralor and physical stock differ

With the contralor digital activo, closing the relevamiento (R7) SHALL be **refused** while, for any controlled
droga, the contralor saldo (latest vigente asiento's `saldo_posterior`) differs from its physical stock (sum of
`cantidad_disponible` of all its partidas); the refusal lists each droga with both figures. With the contralor
manual (paper), no check.

#### Scenario: Contralor saldo differs from the physical stock

- **GIVEN** the contralor digital activo and a controlled droga whose contralor saldo differs from its physical stock
- **WHEN** the DT confirms the close
- **THEN** the close is refused
- **AND** the refusal lists that droga with both figures

#### Scenario: Contralor manual

- **GIVEN** the contralor manual (paper)
- **WHEN** the DT confirms the close
- **THEN** no contralor saldo is compared

### Requirement: R9 — Already-open envase

An envase that was **already open** at the relevamiento SHALL get no special mark: `fecha_apertura` stays NULL and
is set by its first `EGRESO_PREPARACION`, as for any partida (INV-S16/S17). Consequence: when the farmacéutico
overrides the proposed split (INV-S15), INV-S18 may ask for a motivo de apertura adicional on an envase that was
physically open already; the motivo can say so.

#### Scenario: Envase already open at the relevamiento

- **WHEN** an envase that was already open is loaded as existencia inicial
- **THEN** its `fecha_apertura` stays NULL
- **AND** its first `EGRESO_PREPARACION` sets it

### Requirement: R10 — Reports distinguish the origin

Reports SHALL distinguish the origin: the kardex labels the movement "Existencia inicial"; the stock valorizado
includes these partidas (they have costo); the proveedor trayectoria and purchase-based views list only partidas
with a proveedor; the partida detail shows "Origen: existencia inicial".

#### Scenario: Partida de existencia inicial in the reports

- **GIVEN** a partida de existencia inicial without proveedor
- **WHEN** the reports are opened
- **THEN** the kardex labels its movement "Existencia inicial"
- **AND** the stock valorizado includes it
- **AND** the proveedor trayectoria and purchase-based views do not list it
- **AND** its partida detail shows "Origen: existencia inicial"

### Requirement: R11 — Differences after the close

After the relevamiento closes, differences SHALL follow today's rules: a faltante is an `AJUSTE
DIFERENCIA_ARQUEO` with DT authorization (S21); a sobrante follows DP-21b. Existencia inicial is never the way to
fix them.

#### Scenario: Faltante found after the close

- **GIVEN** a relevamiento cerrado
- **WHEN** a faltante is found
- **THEN** it is registered as an `AJUSTE DIFERENCIA_ARQUEO` with DT authorization

#### Scenario: Sobrante found after the close

- **GIVEN** a relevamiento cerrado
- **WHEN** a sobrante is found
- **THEN** it follows DP-21b, not existencia inicial

### Requirement: R12 — Saldo de apertura at the alta of a controlled droga

For a **controlled droga given alta with the contralor digital activo**, the alta SHALL require the **saldo de
apertura** (≥ 0, in the droga's unidad base): what the manual libro shows for that droga, 0 if the pharmacy never
had it. The same transaction writes its `APERTURA` asiento (INV-L15) in the libro its `tipo_control` maps to.

#### Scenario: Alta of a controlled droga

- **GIVEN** the contralor digital activo
- **WHEN** a controlled droga is given alta with its saldo de apertura
- **THEN** the same transaction writes its `APERTURA` asiento in the libro its `tipo_control` maps to

#### Scenario: Alta without saldo de apertura

- **GIVEN** the contralor digital activo
- **WHEN** a controlled droga is given alta without a saldo de apertura
- **THEN** it is refused

### Requirement: R12 — Editing into controlada; contralor manual

Editing a droga **into** controlada with the contralor activo SHALL ask for the same saldo (the edit offers what
the alta offers). Without it, the DB rejects every later movement of the droga (no APERTURA yet, migration 0018)
and R8 has no saldo to compare. With the contralor manual, the field is not shown.

#### Scenario: Droga edited into controlada

- **GIVEN** the contralor digital activo and a droga that is not controlada
- **WHEN** a user edits it into controlada
- **THEN** the form asks for the saldo de apertura

#### Scenario: Contralor manual

- **GIVEN** the contralor manual
- **WHEN** a user gives alta to a controlled droga or edits a droga into controlada
- **THEN** the saldo de apertura field is not shown

## Status

Status: implemented 2026-10-23 (migration 0100). Rollback:
`docs/rollbacks/existencia-inicial.md`. Extends DP-21b (a new positive movement
type besides `INGRESO_COMPRA`). New invariants: INV-S24 (window), INV-S25
(origen ↔ ingreso type), INV-S26 (close once, by the DT).

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

## Enforcement

| # | Enforced in |
|---|---|
| R1 | New enum `origen_partida`, column `partida.origen`; enum value `tipo_movimiento.INGRESO_INICIAL`; `fsj.movimiento_stock_aplicar` (the DP-21b sign check: only `INGRESO_COMPRA` and `INGRESO_INICIAL` add saldo, one ingreso per partida). |
| R2 | App: the new use case (R4). DB: insert trigger on `partida` re-checks the window for `origen = EXISTENCIA_INICIAL`. |
| R3 | zod schema of the use case; DB checks. |
| R4 | Migration. Every read that assumes `partida.proveedor` exists (Prisma type becomes optional) shows "Sin proveedor (existencia inicial)". |
| R5 | `modules/stock/application/ingresar-existencia-inicial.ts`, `modules/stock/ui/existencia-inicial-form.tsx`, `relevamiento-inicial-panel.tsx`. |
| R6 | Domain function `relevamientoAbierto(...)` (pure); DB function used by the R2 trigger. |
| R7 | App: permiso `stock.ajuste.autorizar` + `esDtVigenteHoy`. DB: the two columns are write-once. |
| R8 | Contralor asiento trigger (skip `INGRESO_INICIAL`); the close use case. |
| R9 | No change. |
| R10 | `kardex-movimientos.ts`, `reporte-valorizado.ts`, `trayectoria-repository.ts`, `/partidas/[id]`. |
| R11 | No change. |
| R12 | `modules/drogas` alta/edit use cases + the shared droga form; the contralor repository inserts the APERTURA inside the use case's tenant transaction. |

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
  is activated (today, only by SQL); with it NULL the relevamiento ignores the contralor entirely. The related gap (an
  `INGRESO_COMPRA` of a controlled droga needs its contralor INGRESO, INV-L08) was closed on 2026-10-23 (audit P3-01):
  `registrarPartidaCompra` writes it.
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
