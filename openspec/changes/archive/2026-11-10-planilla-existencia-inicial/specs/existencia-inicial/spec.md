## MODIFIED Requirements

### Requirement: R3 — Data read from the envase

The data of a partida de existencia inicial SHALL be read from the physical envases of the lote: droga, **lote**
(required), **fecha de vencimiento** (required for a `DROGA`, optional for an insumo, trg_partida_validar_vencimiento),
**cantidad** counted (required, > 0, the total of the lote's envases, in any unit of the droga's magnitude), **potencia
declarada** (same rule as a purchase: required when the droga demands it). Unlike a purchase, the vencimiento MAY be
today or a past date: an expired bottle on the shelf is real stock that has to be accounted for and discarded.

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

### Requirement: R7 — Cerrar relevamiento

**Cerrar relevamiento** SHALL be done only by the **DT vigente**, themselves, confirming with their own password
(same pattern as the reanálisis, `verificarPasswordDtPartidaCommand`). Irreversible
(`tenant.relevamiento_inicial_cerrado_en` / `_por_id`, set once, no reopen). Audited (`tenant`, MODIFICAR, with the
number of drogas and partidas loaded). Before confirming, the tab SHALL show how many partidas and drogas were loaded,
the drogas of Faltan cargar and every correction made. The close SHALL be refused while the planilla has rows, unless
the DT explicitly discards them in that same confirmation.

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

## ADDED Requirements

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
a potencia or costo the row states. A blank potencia or costo in a row is not a difference. A group whose droga, lote
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
- **WHEN** the user corrects the cantidad inicial to 100 g
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
