# Reanálisis de partida

## Purpose

A droga partida whose expiry date is reached is not necessarily unusable: the
Director Técnico can have it re-analysed and set a new date. Until the DT acts,
the expired partida stays blocked (today's INV-S10). The DT either records a
**reanálisis** (the partida is usable again until the new date) or **marks it as
vencida** (its whole saldo is discounted). Everyone sees that the partida needs
the DT; only the DT can act.

Implemented 2026-10-12 (see Status). The terms vencimiento vigente, vencida and por vencer are defined in
`## Vocabulary`.

## Requirements

### Requirement: R1 — Only droga partidas

Only partidas of a **droga** (`droga.clase = DROGA`) SHALL be re-analysed or marked as vencida. Insumos keep
their date and today's behaviour (expired = unusable; zeroed with a normal VENCIMIENTO ajuste).

#### Scenario: Reanálisis of an insumo partida

- **GIVEN** a partida of an insumo
- **WHEN** the DT tries to record a reanálisis or mark it as vencida
- **THEN** it is refused

#### Scenario: Expired insumo partida

- **GIVEN** an expired partida of an insumo
- **WHEN** its estado is evaluated
- **THEN** it is unusable
- **AND** it is zeroed with a normal VENCIMIENTO ajuste, not re-analysed

### Requirement: R2 — Scope is the partida

Scope SHALL be the partida (lote), not the droga.

#### Scenario: Two partidas of the same droga

- **GIVEN** two partidas of the same droga
- **WHEN** the DT records a reanálisis on one of them
- **THEN** the other partida's vencimiento vigente does not change

### Requirement: R3 — What a reanálisis records

A reanálisis SHALL record the new date (required, **strictly after** the jornada actual), motivo (optional) and
respaldo (optional free text: certificado de análisis / número de protocolo). No limit on how far or how many
times. Allowed whether the partida is vencida, por vencer or vigente, as long as it has saldo.

#### Scenario: New date equal to the jornada actual

- **WHEN** the DT records a reanálisis whose new date is the jornada actual
- **THEN** it is refused

#### Scenario: Reanálisis without motivo or respaldo

- **WHEN** the DT records a reanálisis with a new date after the jornada actual and no motivo or respaldo
- **THEN** it is recorded

#### Scenario: Vigente partida re-analysed again

- **GIVEN** a vigente droga partida with saldo that already has a reanálisis
- **WHEN** the DT records another reanálisis
- **THEN** it is recorded

#### Scenario: Partida without saldo

- **GIVEN** a droga partida with saldo 0
- **WHEN** a reanálisis is recorded for it
- **THEN** the DB refuses it (INV-S22)

### Requirement: R4 — Original date never overwritten; append-only history

The original `fecha_vencimiento` MUST **never** be overwritten. Each reanálisis is an immutable, append-only row
(`fsj.reanalisis_partida`, tenant-scoped: RLS + `forbid_update_delete`, no UPDATE/DELETE grant), with the vigente
date it replaced (`fecha_vencimiento_anterior`, set by the trigger) and the DT who registered it. Audited in the
same transaction (`reanalisis_partida`, CREAR).

#### Scenario: Reanálisis recorded

- **WHEN** the DT records a reanálisis
- **THEN** `partida.fecha_vencimiento` keeps the printed date
- **AND** a `fsj.reanalisis_partida` row stores the vigente date it replaced and the DT who registered it
- **AND** it is audited in the same transaction as `reanalisis_partida`, CREAR

#### Scenario: Changing a reanálisis row

- **WHEN** a `fsj.reanalisis_partida` row is updated or deleted
- **THEN** it is refused

#### Scenario: Changing the printed date

- **WHEN** `partida.fecha_vencimiento` is updated
- **THEN** the DB refuses it (INV-S23)

### Requirement: R5 — Expired partida blocked

When a droga partida's vencimiento vigente passes, it SHALL be **blocked**: no reserva, no descuento, until the DT
acts (INV-S10 on the vigente date).

#### Scenario: Vencida droga partida

- **GIVEN** a droga partida whose vencimiento vigente is before the jornada actual
- **WHEN** a reserva or a descuento tries to use it
- **THEN** it is blocked

#### Scenario: Vencimiento vigente equal to the jornada

- **GIVEN** a droga partida whose vencimiento vigente is the jornada actual
- **WHEN** a reserva tries to use it
- **THEN** it is not blocked by expiry

#### Scenario: Re-analysed partida

- **GIVEN** a droga partida whose printed date has passed and whose reanálisis date is after the jornada actual
- **WHEN** a reserva tries to use it
- **THEN** it is usable

### Requirement: R6 — Marcar como vencida

**Marcar como vencida**, on a vencida droga partida with saldo, SHALL register, after a warning that its saldo
will be discounted to zero, an AJUSTE motivo VENCIMIENTO for the **whole remaining saldo** (read after the partida
lock, never from the client) through the stock ajuste's own code (`registrarAjusteEnTx`).

#### Scenario: The DT marks a vencida partida

- **GIVEN** the DT vigente and a vencida droga partida with saldo
- **WHEN** the DT confirms "Marcar como vencida" after the warning that its saldo will be discounted to zero
- **THEN** an AJUSTE motivo VENCIMIENTO is registered for the whole remaining saldo, read after the partida lock

#### Scenario: Por vencer partida

- **GIVEN** a por vencer droga partida
- **WHEN** the DT opens it
- **THEN** "Marcar como vencida" is not offered

### Requirement: R6 — Reserved stock; terminal partida

Stock reserved by a preparación INICIADA is not free: the ajuste of "Marcar como vencida" SHALL refuse it with the
recetas holding it (release that reserva first). The partida is then **terminal**.

#### Scenario: Partida with stock reserved

- **GIVEN** a vencida droga partida with stock reserved by a preparación INICIADA
- **WHEN** the DT marks it as vencida
- **THEN** it is refused, naming the recetas holding the reserva

#### Scenario: After marking it as vencida

- **GIVEN** a droga partida marked as vencida
- **WHEN** the DT tries to record a reanálisis on it
- **THEN** it is refused

### Requirement: R7 — Only the DT vigente, in person

Only the **DT vigente** (titular or suplente, `fsj.es_dt_vigente` at the jornada) SHALL perform either action,
**themselves**, confirming with **their own password** in the same form.

#### Scenario: Suplente DT

- **GIVEN** the suplente DT vigente at the jornada, with the permiso `stock.ajuste.autorizar`
- **WHEN** the suplente records a reanálisis confirming with their own password
- **THEN** it is recorded

#### Scenario: User who is not the DT vigente

- **GIVEN** a user who is not the DT vigente at the jornada
- **WHEN** the user tries to record a reanálisis or mark a partida as vencida
- **THEN** it is refused

#### Scenario: Wrong password

- **GIVEN** the DT vigente
- **WHEN** the DT confirms either action with a wrong password
- **THEN** the action is not performed
- **AND** the failed attempt is audited

### Requirement: R8 — Expiry reads use the vencimiento vigente

Every place that evaluates expiry SHALL use the vencimiento vigente: reparto/`estaVencida` callers, partidas para
pesar, the confirmation and "Imprimir etiqueta" (`getPartidasFrescas`), the toma's `reservaAlcanza`, cotizaciones,
INV-S10, `v_stock_droga`, stock alerts (por vencer / vencidas), `/stock` filters and "Próximo vencimiento"
order.

#### Scenario: Re-analysed partida in the preparation flow

- **GIVEN** a droga partida whose printed date has passed and whose reanálisis date is after the jornada actual
- **WHEN** the partidas para pesar are listed
- **THEN** the partida is evaluated by its vencimiento vigente and is not expired

### Requirement: R8 — Listings that use the vencimiento vigente

The vencimiento vigente SHALL also be used by `/partidas` (filter, order, estado), stock valorizado (filter,
order, the date shown) and the proveedor trayectoria (counters and estado).

#### Scenario: Re-analysed partida in the listings

- **GIVEN** a re-analysed droga partida
- **WHEN** `/partidas`, the stock valorizado and the proveedor trayectoria list it
- **THEN** `/partidas` filters, orders and shows its estado by its vencimiento vigente
- **AND** the stock valorizado filters, orders and shows the date by its vencimiento vigente
- **AND** the proveedor trayectoria counts it and shows its estado by its vencimiento vigente

### Requirement: R9 — Partida detail

The partida detail (`/partidas/[id]`) SHALL show the vencimiento vigente with its estado, the original date when
they differ, and the reanálisis history (date registered, anterior → nuevo, respaldo/motivo, DT).

#### Scenario: Re-analysed partida

- **GIVEN** a partida with a reanálisis
- **WHEN** a user opens its detail
- **THEN** it shows the vencimiento vigente with its estado and the original date
- **AND** the reanálisis history with date registered, anterior → nuevo, respaldo/motivo and DT

#### Scenario: Partida never re-analysed

- **GIVEN** a partida without reanálisis
- **WHEN** a user opens its detail
- **THEN** it shows the vencimiento vigente with its estado and no separate original date

### Requirement: R10 — Por vencer warnings

**Por vencer** warnings SHALL be shown in: the home "Alertas de stock" card (por vencer count), `/stock` alert tab,
partida detail banner, and inline (compact badge) wherever the partida is chosen for a descuento: the reserva /
confirmation / modificar reserva form (`confirmar-form.tsx`), the pesar step (`lineas-ficha-tabla.tsx`) and the
reserved partidas of the toma workspace.

#### Scenario: Partida at the end of the alert window

- **GIVEN** `dias_alerta_vencimiento_partida` at its default 30 and a droga partida whose vencimiento vigente is the jornada actual + 30
- **WHEN** it is shown in the reserva / confirmation form (`confirmar-form.tsx`)
- **THEN** it carries the compact por vencer badge

#### Scenario: Partida beyond the alert window

- **GIVEN** `dias_alerta_vencimiento_partida` at its default 30 and a droga partida whose vencimiento vigente is the jornada actual + 31
- **WHEN** it is shown in the reserva / confirmation form (`confirmar-form.tsx`)
- **THEN** it carries no por vencer badge

#### Scenario: Home card

- **GIVEN** droga partidas por vencer
- **WHEN** a user who sees stock opens the home page
- **THEN** the "Alertas de stock" card shows the por vencer count

### Requirement: R11 — Vencida shown to everyone: home and notification bar

**Vencida — requiere acción del DT** SHALL be shown to **everyone** who sees stock: a separate urgent card on the
home page ("Partidas vencidas: requiere acción del DT", links to "Gestión DT › Vencimientos" `/cierres/vencimientos`
when the session can open it -- `cierres.ver` + `stock.ver` -- else to `/stock?vencidas=1`), the app-wide
notification bar (distinct drogas with a vencida / por vencer partida, same link rule).

#### Scenario: Session with cierres.ver and stock.ver

- **GIVEN** a vencida droga partida and a session with `cierres.ver` and `stock.ver`
- **WHEN** the user opens the home page
- **THEN** the card "Partidas vencidas: requiere acción del DT" links to `/cierres/vencimientos`

#### Scenario: Session without cierres.ver

- **GIVEN** a vencida droga partida and a session with `stock.ver` but without `cierres.ver`
- **WHEN** the user opens the home page
- **THEN** the card and the notification bar link to `/stock?vencidas=1`

### Requirement: R11 — Vencimientos tab, stock note, detail banner, buttons

Vencida — requiere acción del DT SHALL also be shown in the `/cierres/vencimientos` tab (vencidas and por vencer
droga partidas, with the DT's actions inline for the DT vigente only), the `/stock` alert note, the partida detail
banner ("Avisale al Director Técnico" when the viewer is not the DT). The action buttons are rendered only for the
DT vigente.

#### Scenario: Viewer who is not the DT

- **GIVEN** a vencida droga partida and a viewer with `stock.ver` who is not the DT
- **WHEN** the viewer opens its detail
- **THEN** the banner says "Avisale al Director Técnico"
- **AND** no action button is rendered

#### Scenario: DT vigente in Vencimientos

- **GIVEN** the DT vigente with `cierres.ver` and `stock.ver`
- **WHEN** the DT opens `/cierres/vencimientos`
- **THEN** the vencidas and por vencer droga partidas are listed with the DT's actions inline

### Requirement: R11 — Blocked partida visible in the preparation flow

In the preparation flow a blocked vencida partida SHALL stay visible with the reason: disabled (never preselected)
in the reserva/confirmation form, listed as "No disponible" in the pesar step, flagged on a reserved partida.

#### Scenario: Vencida partida in the reserva form

- **GIVEN** a vencida droga partida of a línea's droga
- **WHEN** the reserva/confirmation form is shown
- **THEN** the partida is listed disabled, with the reason, and is not preselected

#### Scenario: Reserved partida that expired

- **GIVEN** a reserved droga partida whose vencimiento vigente has passed
- **WHEN** the toma workspace is shown
- **THEN** the reserved partida is flagged

### Requirement: R12 — Preparado expiry unrelated

The preparado's own expiry (`openspec/specs/vencimiento-preparado/spec.md`) SHALL stay unrelated and unchanged.

#### Scenario: Reanálisis of a partida

- **WHEN** the DT records a reanálisis
- **THEN** the preparado expiry rules of `openspec/specs/vencimiento-preparado/spec.md` do not change

## Status

Status: implemented 2026-10-12 (migration 0074). Rollback:
`docs/rollbacks/reanalisis-partida.md`. Revises INV-S10 (plan §9 M07): a partida's
expiry is now its **vencimiento vigente**, not always the printed date.

## Vocabulary

- **Vencimiento original**: `partida.fecha_vencimiento`, the date printed on the
  lot. Never changes.
- **Fecha de reanálisis**: the new date a reanálisis sets.
- **Vencimiento vigente**: the date of the latest reanálisis, else the original
  date (`partida.fecha_vencimiento_vigente`). Every expiry rule uses this one.
- **Vencida**: vencimiento vigente < jornada actual. **Por vencer**: jornada ≤
  vencimiento vigente ≤ jornada + `dias_alerta_vencimiento_partida` (default 30).

## Enforcement

| # | Enforced in |
|---|---|
| R1 | Domain `rechazoReanalisis` / `rechazoMarcarVencida` (`modules/stock/domain/vencimiento-partida.ts`); DB INV-S22 (`fsj.reanalisis_partida_validar`). |
| R2 | `fsj.reanalisis_partida.partida_id`. |
| R3 | `reanalisisCampos` (zod), `rechazoReanalisis`; DB INV-S22. |
| R4 | Migration 0074; `registrarReanalisisPartida` (`modules/stock/application/reanalizar-partida.ts`). DB INV-S23: `fecha_vencimiento` can not change; `fecha_vencimiento_vigente` only through a reanálisis insert. |
| R5 | App: `ordenarParaConsumo` / `proponerReparto` (callers load `fecha_vencimiento_vigente`), `planificarConsumoEnTx`, `fsj.v_stock_droga`. DB: `fsj.movimiento_stock_aplicar` (INV-S10). |
| R6 | `marcarPartidaVencida` (`modules/stock/application/marcar-partida-vencida.ts`). |
| R7 | App: permiso `stock.ajuste.autorizar` + `esDtVigenteHoy(session.usuario.id)` + `verificarPasswordDtPartidaCommand` (own instance of the stock co-firma with the DT fixed to the session's usuario: argon2, lockout counters, failed attempts audited). DB: INV-S22 (`registrado_por_id` DT vigente) for the reanálisis; INV-U05 (`autorizado_por_id` DT vigente) for the ajuste. |
| R8 | `partida-repository.ts`, `preparacion-repository.ts`, `cotizacion-repository.ts`, `valorizado-repository.ts`, `trayectoria-repository.ts`. |
| R9 | `getPartida`, the page. |
| R10 | `estadoVencimientoPartida`, `textoPorVencer`. |
| R11 | `app/(app)/page.tsx`, `app/(app)/layout.tsx` (`resumenVencimientosDrogas`), `app/(app)/cierres/vencimientos/page.tsx` (`listVencimientosDrogas`), `app/(app)/stock/page.tsx`, `app/(app)/partidas/[id]/page.tsx`, `partidas-para-pesar.ts`, `get-toma-receta.ts`. |
| R12 | — |

## Decisions

- **Denormalized `fecha_vencimiento_vigente`, maintained only by triggers.**
  Same pattern as `cantidad_disponible` (0008): initialised from
  `fecha_vencimiento` on INSERT (`trg_partida_inicializar_vencimiento_vigente`,
  ignoring any client value), moved only by the reanálisis' AFTER INSERT trigger
  (SECURITY DEFINER, transaction-local flag `fsj.reanalisis`, checked by
  `partida_validar_update`, INV-S23). Computing it (`coalesce(latest reanálisis,
  fecha_vencimiento)`) would need a lateral subquery in every one of the ~15
  expiry reads (several are plain Prisma `where`/`orderBy`), in `v_stock_droga`
  and in the INV-S10 trigger: easy to miss one, slower for the FEFO orders.
  The column keeps each read a one-column change, and the triggers make
  drift impossible (fsj_app has no UPDATE grant on it, and the guard covers
  any other role). Backfilled = `fecha_vencimiento`.
- **Terminal = saldo 0, no new estado.** A partida can never regain stock
  (DP-21b: no positive ajuste; one INGRESO only), so saldo 0 already is final.
  The DB refuses a reanálisis without saldo (INV-S22), and the alerts only list
  partidas with saldo. This also covers a partida consumed completely.
- **The DT acts personally, with their own password** (like the cierre firma),
  rather than the ajuste's "operator + DT co-firma picker": the requirement is
  that only the DT/designee can perform the actions and that only they see the
  buttons. It still reuses the ajuste's verification code unchanged
  (`verificarCoFirmaDtEnTx` with `dtUsuarioId = session.usuario.id`), so rate
  limiting and audit of failures are identical. For "marcar como vencida",
  `registrado_por_id` = `autorizado_por_id` = the DT (the DB allows it; INV-U05
  checks the authorizer).
- **Permiso `stock.ajuste.autorizar`** (operativo, held by the DT role): no new
  permiso, so no role/permiso migration and no change to the role editor.
- A reanálisis may set a date earlier than the current vigente one (the
  analysis decides; only "after today" is required). "Marcar como vencida" is
  offered only for an already vencida partida; a por vencer one waits or gets a
  reanálisis.
- A normal ajuste (any motivo, with DT co-firma) on an expired droga partida is
  still possible, as before; "marcar como vencida" is the guided path.
- The droga history (`historial-droga`) keeps showing each consumed lot's
  original date: it describes the lot, it does not evaluate expiry.

## Code

- Migration: `prisma/migrations/20261012090000_0074_reanalisis_partida/migration.sql`;
  rollback `prisma/rollbacks/0074_reanalisis_partida.down.sql`.
- Domain: `modules/stock/domain/vencimiento-partida.ts` (estado, por vencer
  text, reanálisis / marcar vencida rules, zod fields); `reparto.ts` documents
  that `fechaVencimiento` is the vigente date.
- Application: `reanalizar-partida.ts`, `marcar-partida-vencida.ts`,
  `verificar-password-dt-partida.ts`, `dias-alerta-vencimiento.ts`,
  `get-partida.ts`, `list-partidas-droga.ts` (`modules/stock/application/`).
- UI: `modules/stock/ui/acciones-dt-partida.tsx`, `modules/stock/ui/actions.ts`
  (`registrarReanalisisAction`, `marcarPartidaVencidaAction`).
- DB messages: `INV-S22`, `INV-S23`, revised `INV-S10` in
  `shared/errors/mensajes-invariantes.ts`.

## Open

- Should a reanálisis be required to move the date **forward** (after the
  current vigente date)? Today only "after the jornada" is enforced.
