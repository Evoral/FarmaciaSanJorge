# Existencia inicial (relevamiento de stock al implementar)

## Purpose

The day a pharmacy starts using the system it already has stock on its shelves.
After loading the drogas, it must **relevar** that stock: every lote becomes a partida;
envases of one lote add up, so it can be consumed with lote, vencimiento and potencia like
any other (INV-S01: stock only exists as partidas; there is no stock number on the
droga).

Loading it as a purchase (`INGRESO_COMPRA`) would invent a proveedor and a
fecha de ingreso, pollute the proveedor trayectoria and, for a controlled droga,
demand a vale de adquisición (INV-L16) the pharmacy does not have. So existing
stock enters through its own door: a partida of origin **existencia inicial**,
allowed only while the tenant's **relevamiento inicial** is open.

Implemented 2026-10-23 (migrations 0100, 0124 and 0127; see Status).

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

The data of a partida de existencia inicial SHALL be read from the physical envases of the lote: droga, **lote**
(required), **fecha de vencimiento** (required for a `DROGA`, optional for an insumo), **cantidad** counted
(required, > 0, the total of the lote's envases, in any unit of the droga's magnitude), and **potencia declarada**
(required when the droga demands it). Unlike a purchase, the vencimiento MAY be today or a past date to account
for expired stock on the shelf.

#### Scenario: Cantidad zero

- **WHEN** a row is completed with cantidad 0
- **THEN** it is not complete and cannot pass to stock

#### Scenario: DROGA without fecha de vencimiento

- **GIVEN** a droga whose `clase` is `DROGA`
- **WHEN** a row of it has no fecha de vencimiento
- **THEN** it is not complete and cannot pass to stock

#### Scenario: Insumo without fecha de vencimiento

- **GIVEN** an insumo
- **WHEN** a row of it has no fecha de vencimiento
- **THEN** the partida can be created

#### Scenario: Expired bottle on the shelf

- **GIVEN** a bottle whose vencimiento is before the jornada actual
- **WHEN** its row passes to stock
- **THEN** the partida is created
- **AND** it is not available for preparaciones (INV-S10) and shows among the vencidas con saldo

### Requirement: R3 — Costo unitario and proveedor

The data of a row SHALL include an optional **costo unitario** (≥ 0, prefilled with the droga's vigente costo de
proveedor when there is one) and an optional **proveedor**. A row with no costo passes with the vigente costo, or with
0 when there is none; a partida de existencia inicial with costo 0 is counted as "sin costo" and is fixed through the
existing costo correction.

#### Scenario: Droga with a vigente costo de proveedor

- **GIVEN** a droga with a vigente costo de proveedor
- **WHEN** the user picks it in a row
- **THEN** the costo unitario is prefilled with that costo

#### Scenario: Negative costo unitario

- **WHEN** a row has a costo unitario below 0
- **THEN** it is refused

#### Scenario: Envase without proveedor

- **WHEN** a row without proveedor passes to stock
- **THEN** the partida is created without proveedor

#### Scenario: No costo and no vigente costo

- **GIVEN** a droga with no vigente costo de proveedor
- **WHEN** a row of it with no costo passes to stock
- **THEN** the partida is created with costo 0
- **AND** the tab counts it as "sin costo"

### Requirement: R3b — Costo per the row's unidad

The costo unitario of a row SHALL be the price of ONE unit of the row's own unidad (a kg for a row in kg, as on the
invoice). Pasar a stock SHALL divide it by the `fsj.convertir` factor to the unidad base, rounded to 6 decimals like
the invoice import, and store that as the partida's costo; costo conflicts (R15) compare these converted values. The
vigente costo used for a row without costo is already per unidad base and is not converted.

#### Scenario: Costo typed per kg for a droga measured in mg

- **GIVEN** a droga whose unidad base is mg
- **WHEN** a row of 2 kg with a costo unitario of $ 50.000 passes to stock
- **THEN** the partida is created with 2.000.000 mg and a costo of $ 0,05 per mg

#### Scenario: Same price typed in different units

- **GIVEN** two rows of the same group, one of 1 kg at $ 50.000 and one of 500 g at $ 50
- **WHEN** the group passes to stock
- **THEN** the rows are not en conflicto and the partida's costo is $ 0,05 per mg

### Requirement: R3c — Costo correction per a chosen unidad

The costo correction of any partida (its page and this tab, `corregir-costo-partida.ts`) SHALL accept the costo per a
vigente unidad of the droga's magnitude, the unidad base by default, convert it like R3b and show the value per unidad
base it will store before saving. A unidad of another magnitude or dada de baja SHALL be refused on that field. The
audit SHALL keep the costo and unidad typed besides the stored costo.

#### Scenario: Correction typed per kg

- **GIVEN** a partida of a droga whose unidad base is g
- **WHEN** its costo is corrected to $ 50.000 per kg
- **THEN** the partida's costo is $ 50 per g
- **AND** the audit keeps $ 50.000 and kg

#### Scenario: Unidad of another magnitude

- **WHEN** a costo correction names a unidad of another magnitude
- **THEN** it is refused on the unidad and the costo stays

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

Passing to stock SHALL be a `defineCommand` use case per group of rows, permiso `stock.partida.ingresar`
(PIN-configurable: `conOperador`, verified once per press), audited (`partida`, CREAR or MODIFICAR, with `origen`),
running the manual alta's own rules (`registrarPartidaCompra` with `origen`) when it creates the partida. Saving or
removing a planilla row SHALL use the permiso `stock.relevamiento.editar`, which is not PIN-configurable: a row does
not touch stock.

#### Scenario: Envase loaded

- **GIVEN** a user with the permiso `stock.partida.ingresar` and the relevamiento abierto
- **WHEN** the user passes a complete group of rows that creates a partida
- **THEN** the partida is created through `registrarPartidaCompra` with `origen`
- **AND** it is audited as `partida`, CREAR, with `origen`

#### Scenario: User without the permiso

- **GIVEN** a user without the permiso `stock.partida.ingresar`
- **WHEN** the user tries to pass rows to stock
- **THEN** it is refused

#### Scenario: Row edited on a shared session

- **GIVEN** a cuenta de sector with PIN required for `stock.partida.ingresar`
- **WHEN** a row of the planilla is saved
- **THEN** no PIN is asked

### Requirement: R5 — Existencia inicial panel

The UI SHALL be a tab **Existencia inicial** at `/partidas/existencia-inicial`, next to the list of partidas, with the
state of the relevamiento, the planilla, what already passed to stock and, for the DT vigente, the close. `/partidas/ingresar`
SHALL NOT show anything of the relevamiento. The tab is shown while the relevamiento is abierto or when the tenant has
a partida de existencia inicial; once the relevamiento ends it is read-only and states who closed it and when.

#### Scenario: Relevamiento abierto

- **GIVEN** the relevamiento is abierto
- **WHEN** a user opens `/partidas`
- **THEN** the tab "Existencia inicial" is shown

#### Scenario: Relevamiento cerrado, with partidas loaded

- **GIVEN** the relevamiento is cerrado and the tenant has partidas de existencia inicial
- **WHEN** a user opens the tab
- **THEN** what was loaded is shown read-only, with who closed it and when

#### Scenario: Relevamiento cerrado

- **GIVEN** the relevamiento is cerrado and the tenant has no partida de existencia inicial
- **WHEN** a user opens `/partidas`
- **THEN** the tab is not shown

#### Scenario: Purchase page

- **GIVEN** the relevamiento is abierto
- **WHEN** a user opens `/partidas/ingresar`
- **THEN** only the purchase forms are shown

#### Scenario: Submit with an error

- **WHEN** saving a row or passing it to stock fails
- **THEN** every field of the row keeps what the user entered and the offending one is marked

#### Scenario: Submit that succeeds

- **WHEN** a row passes to stock
- **THEN** it leaves the planilla and appears among what already passed

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

**Cerrar relevamiento** SHALL be done only by the **DT vigente**, confirming with their own password
(`verificarPasswordDtPartidaCommand`). Irreversible (`tenant.relevamiento_inicial_cerrado_en` / `_por_id`, set once,
no reopen). Audited (`tenant`, MODIFICAR). Before confirming, the tab SHALL show summary counts, the drogas of
Faltan cargar and every correction made. The close SHALL be refused while the planilla has rows, unless the DT
explicitly discards them in that same confirmation.

#### Scenario: The DT closes the relevamiento

- **GIVEN** the DT vigente, with the permiso `stock.ajuste.autorizar`, the relevamiento abierto and an empty planilla
- **WHEN** the DT confirms the close with their own password
- **THEN** `tenant.relevamiento_inicial_cerrado_en` / `_por_id` are set
- **AND** it is audited as `tenant`, MODIFICAR, with the number of drogas and partidas loaded

#### Scenario: Before confirming

- **GIVEN** the DT vigente and the relevamiento abierto
- **WHEN** the DT opens the close
- **THEN** the tab shows how many partidas and drogas were loaded, the drogas of Faltan cargar and the corrections made

#### Scenario: Drogas still missing

- **GIVEN** drogas listed in Faltan cargar
- **WHEN** the DT confirms the close
- **THEN** the close is allowed

#### Scenario: Rows left in the planilla

- **GIVEN** a planilla with rows
- **WHEN** the DT confirms the close without discarding them
- **THEN** the close is refused

#### Scenario: Rows discarded on close

- **GIVEN** a planilla with rows
- **WHEN** the DT confirms the close and discards them
- **THEN** the rows are removed in the same transaction and the number discarded is audited

#### Scenario: A user who is not the DT vigente

- **GIVEN** a user who is not the DT vigente
- **WHEN** the user tries to close the relevamiento
- **THEN** it is refused

#### Scenario: Reopening a closed relevamiento

- **GIVEN** a relevamiento closed by the DT
- **WHEN** `tenant.relevamiento_inicial_cerrado_en` or `_por_id` is written again
- **THEN** the DB refuses it

### Requirement: R8 — No contralor asiento for an INGRESO_INICIAL

**Controlled drogas, contralor digital activo** (`tenant.fecha_activacion_contralor` not NULL): an `INGRESO_INICIAL`
or a corrección inicial MUST **never** generate a contralor asiento; the droga's `APERTURA` asiento (INV-L15, saldo of
the manual libro) already accounts for that physical stock, and a correction is not a movement of goods.

#### Scenario: Existencia inicial of a controlled droga

- **GIVEN** the contralor digital activo and a controlled droga
- **WHEN** a partida de existencia inicial of that droga is created
- **THEN** its `INGRESO_INICIAL` generates no contralor asiento

#### Scenario: Corrección of a controlled droga

- **GIVEN** the contralor digital activo and a controlled droga
- **WHEN** a partida de existencia inicial of that droga is corrected
- **THEN** the correction generates no contralor asiento
- **AND** the close still compares the contralor saldo with the physical stock (R8)

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

Reports SHALL distinguish the origin: the kardex labels the ingreso "Existencia inicial" and each correction "Existencia
inicial (suma)" or "Existencia inicial (resta)"; the stock valorizado includes these partidas; the
proveedor trayectoria and purchase-based views list only partidas with a proveedor; the partida detail shows "Origen:
existencia inicial".

#### Scenario: Partida de existencia inicial in the reports

- **GIVEN** a partida de existencia inicial without proveedor
- **WHEN** the reports are opened
- **THEN** the kardex labels its movement "Existencia inicial"
- **AND** the stock valorizado includes it
- **AND** the proveedor trayectoria and purchase-based views do not list it
- **AND** its partida detail shows "Origen: existencia inicial"

#### Scenario: Corrected partida in the kardex

- **GIVEN** a partida with an `INGRESO_INICIAL` of 100 and a suma of 400
- **WHEN** the kardex is opened
- **THEN** it shows both movements, the `INGRESO_INICIAL` still at 100 and the suma labeled "Existencia inicial (suma)"

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

### Requirement: R13 — Planilla

The planilla SHALL be an editable draft of rows with droga, lote, vencimiento, cantidad, unidad, potencia, costo and
proveedor, all optional while being typed, one row per droga + lote. Rows SHALL be saved as they are typed, stay until
passed or removed, and be shared by every user of the tenant. A row SHALL have no effect on stock. "Agregar fila" and
Enter on the last field add a row and leave the cursor in its first field.

#### Scenario: Half-done row

- **WHEN** a user types a droga and a lote and leaves
- **THEN** the row is kept and appears when anyone opens the tab

#### Scenario: Stock untouched

- **GIVEN** a complete row that was not passed
- **WHEN** the stock is read
- **THEN** the row counts for nothing

#### Scenario: Removing a row

- **WHEN** a user removes a row
- **THEN** it disappears, with no trace in stock or kardex

#### Scenario: Rows while the relevamiento is cerrado

- **GIVEN** the relevamiento is cerrado
- **WHEN** a row is inserted or updated
- **THEN** the DB refuses it

### Requirement: R14 — State of a row

Each row SHALL show its state: **lista**, **incompleta** (naming what is missing), **se suma** (to another row or to a
partida already in stock) or **en conflicto** (naming the difference).

#### Scenario: Missing field

- **WHEN** a row has a droga but no lote
- **THEN** it is shown as incompleta, naming the lote

#### Scenario: Same lote in two rows

- **GIVEN** two complete rows with the same droga, lote and proveedor and equal data
- **WHEN** the planilla is shown
- **THEN** both are shown as se suma

#### Scenario: Different vencimiento in the same lote

- **GIVEN** two rows with the same droga, lote and proveedor and different vencimiento
- **WHEN** the planilla is shown
- **THEN** both are shown as en conflicto, naming the vencimiento

### Requirement: R15 — Pasar a stock

Pasar a stock SHALL process every complete row, grouped by droga + lote + proveedor, adding their quantities in the
droga's unidad base. It MAY be pressed as many times as needed while the relevamiento is abierto. Each group SHALL run
in its own transaction, in which its rows are removed from the planilla, so a retry never duplicates. Before running,
a dialog SHALL show the rows, the resulting partidas, those without costo and those expired.

#### Scenario: New lote

- **GIVEN** a complete row with no partida for its droga, lote and proveedor
- **WHEN** Pasar a stock runs
- **THEN** a partida de origen `EXISTENCIA_INICIAL` is created with one `INGRESO_INICIAL`
- **AND** the row leaves the planilla

#### Scenario: Two rows of one lote

- **GIVEN** two complete rows of one group, 100 g and 50 g
- **WHEN** Pasar a stock runs
- **THEN** one partida is created with one `INGRESO_INICIAL` of 150 g

#### Scenario: Lote already passed

- **GIVEN** a partida de existencia inicial for that droga, lote and proveedor and the relevamiento abierto
- **WHEN** a complete row of that group passes
- **THEN** no new partida is created
- **AND** a `CORRECCION_INICIAL_SUMA` adds the row's quantity to that partida

#### Scenario: Incomplete rows

- **GIVEN** complete and incomplete rows
- **WHEN** Pasar a stock runs
- **THEN** the incomplete rows stay in the planilla, untouched

#### Scenario: One group fails

- **GIVEN** a group whose alta fails
- **WHEN** Pasar a stock runs
- **THEN** the other groups pass
- **AND** the failed rows stay in the planilla with the reason

#### Scenario: Relevamiento ended

- **GIVEN** the relevamiento is cerrado
- **WHEN** Pasar a stock runs
- **THEN** it is refused and the rows stay as they are

### Requirement: R15 — Rows that cannot pass

A group SHALL NOT pass while it is en conflicto: its rows, or the partida it would add to, differ in vencimiento, or in
a potencia or costo the row states (the costo converted to the unidad base, R3). A blank potencia or costo in a row is
not a difference. A group whose droga, lote
and proveedor match a partida that is not of origen `EXISTENCIA_INICIAL` SHALL NOT pass.

#### Scenario: Vencimiento differs from the partida

- **GIVEN** a partida de existencia inicial with a vencimiento
- **WHEN** a row of its group states another vencimiento
- **THEN** the row does not pass and shows both dates

#### Scenario: Blank costo

- **GIVEN** a partida de existencia inicial with a costo
- **WHEN** a row of its group with no costo passes
- **THEN** it adds to the partida and the costo stays

#### Scenario: Same lote as a purchase

- **GIVEN** a `COMPRA` partida of the same droga, proveedor and lote
- **WHEN** a row of that group is passed
- **THEN** the row does not pass and says that lote already entered as a purchase

### Requirement: R16 — Faltan cargar

The tab SHALL list the active drogas with no partida de existencia inicial and no row in the planilla, including those
with stock from a purchase, since older stock may remain on the shelf. The list SHALL be computed, informative, and
block nothing.

#### Scenario: Droga with only purchases

- **GIVEN** an active droga with a `COMPRA` partida and no existencia inicial
- **WHEN** the tab is opened
- **THEN** the droga is listed in Faltan cargar

#### Scenario: Droga already counted

- **GIVEN** a droga with a partida de existencia inicial
- **WHEN** the tab is opened
- **THEN** the droga is not listed

### Requirement: R17 — Correction of the cantidad

While the relevamiento is abierto, a user with the permiso `stock.partida.ingresar` SHALL be able to correct the
cantidad of a partida de existencia inicial, used or not, by typing the **correct cantidad inicial**. The system SHALL
write the difference as a `CORRECCION_INICIAL_SUMA` or `CORRECCION_INICIAL_RESTA`, with an optional observación and
never an `AJUSTE`. The `cantidad_disponible` MUST stay at or above the quantity reserved.

#### Scenario: Correction upward after use

- **GIVEN** a partida of 100 g with 20 g consumed
- **WHEN** the user corrects the cantidad inicial to 500 g
- **THEN** a `CORRECCION_INICIAL_SUMA` of 400 g is written
- **AND** the disponible is 480 g and the `INGRESO_INICIAL` still reads 100 g

#### Scenario: Correction downward

- **GIVEN** a partida of 500 g of a non-controlled droga, unused
- **WHEN** the user corrects its cantidad inicial to 100 g
- **THEN** a `CORRECCION_INICIAL_RESTA` of 400 g is written, with no DT

#### Scenario: Below what is reserved or consumed

- **GIVEN** a partida with 80 g disponible and 30 g reserved
- **WHEN** the correction would leave less than 30 g disponible
- **THEN** it is refused, stating the minimum

#### Scenario: Taken to zero

- **GIVEN** an unused partida loaded under the wrong droga
- **WHEN** the user corrects its cantidad inicial to 0
- **THEN** the partida stays with cantidad 0, shown as anulada, and the stock is loaded under the right droga

### Requirement: R17 — Controlled drogas need the DT to go down

A `CORRECCION_INICIAL_RESTA` on a droga with `tipo_control` other than `NINGUNO` MUST carry the co-firma of a DT
vigente (`verificarCoFirmaDt`). The DB SHALL refuse it otherwise. A `CORRECCION_INICIAL_SUMA` needs no co-firma.

#### Scenario: Controlled droga lowered without DT

- **GIVEN** a controlled droga
- **WHEN** a `CORRECCION_INICIAL_RESTA` is inserted with no DT vigente as autorizado
- **THEN** the DB refuses it

#### Scenario: Controlled droga raised

- **GIVEN** a controlled droga
- **WHEN** its cantidad inicial is corrected upward
- **THEN** no co-firma is asked

### Requirement: R17 — Cantidad inicial is the total entered

`partida.cantidad_inicial` SHALL be the total entered: the `INGRESO_INICIAL` plus its sumas minus its restas. It MUST
change only through the movement trigger, together with `cantidad_disponible`, only for origen `EXISTENCIA_INICIAL`.
Only for that origen MAY it reach 0.

#### Scenario: Direct update

- **WHEN** `cantidad_inicial` is updated outside a movement
- **THEN** the DB refuses it

#### Scenario: Partida of a purchase

- **GIVEN** a `COMPRA` partida
- **WHEN** a corrección inicial is inserted on it
- **THEN** the DB refuses it

### Requirement: R18 — Correction of the data of an unused partida

While the relevamiento is abierto, the lote, vencimiento and proveedor of a partida de existencia inicial SHALL be
editable only while it is **unused**: no movement other than its ingreso and corrections, no reserva, no reanálisis and
no `fecha_apertura`. Once used they are frozen, because they may be in the libro recetario. The droga is never
editable. Audited with old and new values. INV-S23 is relaxed only for this path.

#### Scenario: Lote mistyped on an unused partida

- **GIVEN** an unused partida de existencia inicial
- **WHEN** the user corrects its lote
- **THEN** the lote changes and the change is audited

#### Scenario: Vencimiento of an unused partida

- **GIVEN** an unused partida de existencia inicial
- **WHEN** the user corrects its vencimiento
- **THEN** `fecha_vencimiento` and `fecha_vencimiento_vigente` both take the new date

#### Scenario: Partida already used

- **GIVEN** a partida de existencia inicial with an `EGRESO_PREPARACION`
- **WHEN** its lote or vencimiento is changed
- **THEN** it is refused, and the form offers only the cantidad and the costo

#### Scenario: Colliding lote

- **GIVEN** another partida with the droga, proveedor and new lote
- **WHEN** the lote is corrected
- **THEN** it is refused with a message naming the lote

### Requirement: R19 — Corrections end with the relevamiento

Every correction of R17 and R18 MUST be refused when the relevamiento is not abierto, whether the DT closed it or the
plazo ran out. The DB SHALL enforce it with `fsj.relevamiento_inicial_abierto`.

#### Scenario: Closed by the DT

- **GIVEN** a relevamiento closed by the DT
- **WHEN** a corrección inicial is inserted
- **THEN** the DB refuses it

#### Scenario: Plazo ran out

- **GIVEN** a relevamiento past its plazo and not closed by the DT
- **WHEN** the data of a partida de existencia inicial is corrected
- **THEN** the DB refuses it

### Requirement: R20 — Plazo alert

From seven days before `fsj.relevamiento_inicial_fecha_limite`, every user with `stock.ver` SHALL see an app-wide
banner stating the days left, the drogas of Faltan cargar and the rows in the planilla. Computed, not a job.

#### Scenario: Seven days before the limit

- **GIVEN** a relevamiento abierto whose fecha límite is seven days after the jornada actual
- **WHEN** a user opens any page
- **THEN** the banner is shown

#### Scenario: No signed cierre yet

- **GIVEN** a tenant with no signed cierre diario
- **WHEN** a user opens any page
- **THEN** no banner is shown

#### Scenario: Relevamiento closed

- **GIVEN** the relevamiento is cerrado
- **WHEN** a user opens any page
- **THEN** no banner is shown

### Requirement: R21 — Import from Excel

The tab SHALL import an `.xlsx` into the planilla as ordinary rows, matching each droga by name or sinónimo. A row whose
droga or unidad is not recognized SHALL stay as an incompleta row keeping what was read. Importing SHALL NOT touch stock.

#### Scenario: Recognized rows

- **WHEN** a file with known drogas is imported
- **THEN** its rows appear in the planilla with their state, and nothing passes to stock

#### Scenario: Unknown droga

- **WHEN** a row names a droga that is not recognized
- **THEN** it stays incompleta, showing the text read so the user can pick the droga

## Status

Status: implemented 2026-10-23 (migration 0100), expanded 2026-11-10 (migrations 0124 and 0127). Rollbacks:
`docs/rollbacks/existencia-inicial.md` and `docs/rollbacks/planilla-existencia-inicial.md`. Extends DP-21b (a new positive movement
type besides `INGRESO_COMPRA`). New invariants: INV-S24 (window), INV-S25
(origen ↔ ingreso type), INV-S26 (close once, by the DT).

## Vocabulary

- **Partida de existencia inicial**: a partida whose `origen = EXISTENCIA_INICIAL`,
  created from counted stock during the relevamiento. Its initial ingreso is an
  `INGRESO_INICIAL` movement, and it may receive initial corrections (`CORRECCION_INICIAL_SUMA`
  or `CORRECCION_INICIAL_RESTA`).
- **Relevamiento inicial**: the tenant-level window during which partidas de
  existencia inicial can be created and corrected. **Abierto** or **cerrado**; once cerrado it
  never reopens.
- **Plazo del relevamiento**: `dias_relevamiento_inicial` (tenant parameter,
  default 30, **at most 90** — three months) counted from the jornada of the
  tenant's **first signed cierre diario**.
- **Planilla**: an editable draft table (`fsj.relevamiento_fila`) shared across
  users of the tenant where counted stock is staged before passing to stock, having
  no effect on stock while in draft.
- **Fila**: a single row in the planilla, showing its state: **lista**, **incompleta**
  (naming what is missing), **se suma** (to another row or to an existing partida) or
  **en conflicto** (naming the discrepancy).
- **Pasar a stock**: operation that processes complete, conflict-free planilla rows,
  grouping them by droga + lote + proveedor, summing their quantities in the droga's
  unidad base, creating or adding to partidas de existencia inicial, and removing
  the processed rows from the planilla.
- **Faltan cargar**: informative list of active drogas in the catalog that have no
  partida de existencia inicial and no row in the planilla.
- **Corrección inicial**: an in-window adjustment to a partida de existencia inicial:
  either correcting its `cantidad_inicial` via `CORRECCION_INICIAL_SUMA` or
  `CORRECCION_INICIAL_RESTA` (never an `AJUSTE`), or modifying the lote, vencimiento,
  or proveedor of an unused partida.
- **Anulada**: a partida de existencia inicial whose `cantidad_inicial` was corrected
  down to 0 (e.g. loaded under the wrong droga); it stays with saldo 0 for audit and
  traceability and is shown as anulada.

## Enforcement

| # | Enforced in |
|---|---|
| R1 | New enum `origen_partida`, column `partida.origen`; enum values `tipo_movimiento.INGRESO_INICIAL`, `CORRECCION_INICIAL_SUMA`, `CORRECCION_INICIAL_RESTA` (migration 0124); `fsj.movimiento_stock_aplicar`. |
| R2 | App: `modules/stock/application/pasar-grupo-a-stock.ts`. DB: trigger `trg_partida_validar_relevamiento_inicial` on `partida` (migration 0100). |
| R3 | Domain `modules/stock/domain/planilla-existencia-inicial.ts`; `modules/stock/application/guardar-fila-relevamiento.ts`; DB checks on `partida`. |
| R4 | Migration 0100 (`proveedor_id IS NOT NULL OR origen = 'EXISTENCIA_INICIAL'`). Every read that assumes `partida.proveedor` exists shows "Sin proveedor (existencia inicial)". |
| R5 | `modules/stock/application/pasar-grupo-a-stock.ts`, `modules/stock/application/guardar-fila-relevamiento.ts`, `modules/stock/application/quitar-fila-relevamiento.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`, `modules/stock/ui/relevamiento-inicial-panel.tsx`. |
| R6 | Domain function `relevamientoInicialAbierto` (pure); DB function `fsj.relevamiento_inicial_abierto` (migration 0100). |
| R7 | App: `modules/stock/application/cerrar-relevamiento-inicial.ts`, `modules/stock/application/get-correcciones-relevamiento.ts`, `modules/stock/ui/relevamiento-inicial-panel.tsx`. DB: `tenant.relevamiento_inicial_cerrado_en` / `_por_id` write-once (migration 0100). |
| R8 | Contralor trigger `fsj.movimiento_stock_validar_contralor` (exempts `INGRESO_INICIAL`, `CORRECCION_INICIAL_SUMA`, `CORRECCION_INICIAL_RESTA`, migration 0124); close use case `cerrar-relevamiento-inicial.ts`. |
| R9 | No change: `fecha_apertura` stays NULL until first `EGRESO_PREPARACION`. |
| R10 | `modules/stock/application/reporte-kardex.ts`, `modules/stock/application/reporte-valorizado.ts`, `modules/stock/infrastructure/trayectoria-repository.ts`, `/partidas/[id]`. |
| R11 | No change: post-close differences follow `AJUSTE DIFERENCIA_ARQUEO` or DP-21b. |
| R12 | `modules/drogas` alta/edit use cases + the shared droga form; contralor repository inserts `APERTURA`. |
| R13 | Table `fsj.relevamiento_fila` (migration 0124); `modules/stock/application/guardar-fila-relevamiento.ts`, `modules/stock/application/quitar-fila-relevamiento.ts`, `modules/stock/application/get-planilla-relevamiento.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`. |
| R14 | Domain `modules/stock/domain/planilla-existencia-inicial.ts` (`estadoFila`, `agruparFilas`, `conflictosGrupo`); `modules/stock/application/get-planilla-relevamiento.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`. |
| R15 | `modules/stock/application/pasar-grupo-a-stock.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`, migration 0124. |
| R16 | `modules/stock/application/get-planilla-relevamiento.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`. |
| R17 | `modules/stock/application/corregir-cantidad-inicial.ts`, `modules/stock/application/get-correcciones-relevamiento.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`, migration 0124 (`trg_partida_cantidad_inicial`, `fsj.movimiento_stock_validar_cofirma_dt`). |
| R18 | `modules/stock/application/corregir-datos-partida-inicial.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`, migration 0127 (`fsj.corregir_datos_partida_inicial`). |
| R19 | DB triggers `fsj.relevamiento_inicial_abierto` enforced in `movimiento_stock_aplicar` and `fsj.corregir_datos_partida_inicial` (migrations 0124 and 0127); `corregir-cantidad-inicial.ts`, `corregir-datos-partida-inicial.ts`. |
| R20 | `modules/stock/application/resumen-relevamiento.ts`, `modules/stock/ui/relevamiento-inicial-panel.tsx`. |
| R21 | `modules/stock/application/importar-planilla-excel.ts`, `modules/stock/application/plantilla-existencia-inicial.ts`, `modules/stock/ui/planilla-existencia-inicial.tsx`. |

## Decisions

- **Every lote becomes a partida; envases of one lote add up.** A physical stock intake
  frequently counts multiple bottles or packages of the same lot. Instead of creating distinct
  partidas per bottle, rows of the same lote, vencimiento, and proveedor sum into one partida (or
  add to an existing one via `CORRECCION_INICIAL_SUMA`).
- **Draft planilla before stock.** Staging counted rows in an uncommitted table (`fsj.relevamiento_fila`)
  lets operators type data concurrently, leave rows incomplete, and resolve conflicts before any
  movement touches stock or generates audit noise.
- **Corrections as initial movements, never AJUSTE.** Adjustments made while the window is open
  update `cantidad_inicial` and `cantidad_disponible` through `CORRECCION_INICIAL_SUMA` / `CORRECCION_INICIAL_RESTA`
  (never `AJUSTE`), preserving true origin semantics and leaving `AJUSTE` for operational losses/surpluses post-close.
- **Unused partidas allow metadata corrections.** Mistakes in typing lote, vencimiento, or proveedor
  on an unused partida can be corrected in place without an annulment, using migration 0127
  (`fsj.corregir_datos_partida_inicial`). Once consumed or reserved, metadata freezes to preserve the
  libro recetario chain.
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
- **Import from Excel stages draft rows.** Importing an `.xlsx` never touches stock directly;
  it populates the planilla with rows (evaluating recognized drogas and units) so the team reviews
  and confirms before passing to stock.

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
