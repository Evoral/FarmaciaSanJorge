# Trayectoria del paciente

## Purpose

A per-patient view that shows everything a paciente has gone through in the system, receta by receta, in one
screen. Read-only. Approved by user 2026-10-01 (see Status).

## Requirements

### Requirement: Datos and Trayectoria tabs

`/pacientes/[id]` SHALL get two tabs: **Datos** -> `/pacientes/[id]` (current edit / baja / reactivar page,
unchanged) and **Trayectoria** -> `/pacientes/[id]/trayectoria` (new).

#### Scenario: Opening a paciente

- **WHEN** the user opens `/pacientes/[id]`
- **THEN** the Datos and Trayectoria tabs are shown
- **AND** the Datos tab is the existing edit / baja / reactivar page

### Requirement: Trayectoria button in the list

The `/pacientes` list SHALL get a "Trayectoria" button per row.

#### Scenario: Paciente list

- **WHEN** the user opens `/pacientes`
- **THEN** each row has a "Trayectoria" button that opens that paciente's Trayectoria

### Requirement: Nothing identifying in the URL

URLs SHALL carry only the opaque UUID and a plain `?page=` integer. Nothing identifying MUST go in them (DP-24 /
Ley 25.326), same as the rest of `/pacientes`.

#### Scenario: Paging the trayectoria

- **WHEN** the user moves to page 2 of a paciente's Trayectoria
- **THEN** the URL carries only the paciente's UUID and `?page=2`

### Requirement: Guard pacientes.gestionar

Both tabs SHALL live under the existing `app/(app)/pacientes/layout.tsx` guard (`pacientes.gestionar`).

#### Scenario: Session without pacientes.gestionar

- **GIVEN** a session without `pacientes.gestionar`
- **WHEN** it opens `/pacientes/[id]/trayectoria`
- **THEN** the guard refuses it

### Requirement: Datos tab exact active state

Tab active state MUST be exact for "Datos" (`/pacientes/[id]` is a prefix of `/pacientes/[id]/trayectoria`).

#### Scenario: On the Trayectoria tab

- **WHEN** the user is on `/pacientes/[id]/trayectoria`
- **THEN** only the Trayectoria tab is active

### Requirement: Header

The header SHALL show apellido, nombre, DNI, nro. de credencial, estado (vigente / dado de baja + motivo).

#### Scenario: Paciente dado de baja

- **GIVEN** a paciente dado de baja
- **WHEN** the user opens the Trayectoria
- **THEN** the header shows the estado "dado de baja" with its motivo

### Requirement: Resumen over all the recetas

The resumen SHALL count over ALL the patient's recetas, not just the page: total, en curso (not
ENTREGADA/ANULADA), entregadas, anuladas, última atención (max `fechaIngreso`).

#### Scenario: Paciente with more than one page

- **GIVEN** a paciente with 15 recetas
- **WHEN** the user views page 1 of the Trayectoria
- **THEN** the resumen total is 15

### Requirement: Recetas list

Recetas SHALL be shown newest first (`fechaIngreso desc`), paginated (`?page=`, page size 10). Each receta MUST be
an expandable row of a `table.data-table` (summary: número, ingreso, qué pide, médico, estado, etapa, presupuesto;
the expanded detail shows its journey: **Ingreso -> Preparación -> Libro -> Entrega -> Archivo**).

#### Scenario: Paging

- **GIVEN** a paciente with 15 recetas
- **WHEN** the user opens the Trayectoria
- **THEN** page 1 shows the 10 newest by `fechaIngreso`

#### Scenario: Expanding a receta

- **WHEN** the user expands a receta row
- **THEN** its journey Ingreso -> Preparación -> Libro -> Entrega -> Archivo is shown

### Requirement: Ingreso step

The Ingreso step SHALL show nro. interno, fecha de ingreso, fecha de prescripción, médico, origen (presencial /
PDF), estado badge, items (forma + drogas), presupuesto vigente (sum of the latest cotización per item; flag
partial/incomplete).

#### Scenario: Item without cotización

- **GIVEN** a session with `cotizaciones.ver` and a receta with two items, only one cotizado
- **WHEN** the user expands it
- **THEN** the presupuesto vigente is that item's latest cotización, flagged partial/incomplete

### Requirement: Preparación step

The Preparación step SHALL show, per item: estado (INICIADA / CONFIRMADA / DESCARTADA), iniciada/confirmada/descartada
dates, motivo de descarte.

#### Scenario: Discarded preparación

- **GIVEN** a session with `preparaciones.iniciar` and an item whose preparación was DESCARTADA
- **WHEN** the user expands the receta
- **THEN** the item shows DESCARTADA, its dates and the motivo de descarte

### Requirement: Libro step

The Libro step SHALL show, per item: asiento nro. correlativo, fecha, derived visual state (vigente / anulado / sin
efecto por rectificación). It MUST be linked via preparacion -> asiento SISTEMA (+ its rectificativos through
`asientoOriginalId`), never matched by `pacienteTexto`.

#### Scenario: Rectified asiento

- **GIVEN** a session with `libro.ver` and an item whose asiento SISTEMA has a rectificativo
- **WHEN** the user expands the receta
- **THEN** the item shows that asiento with the derived visual state "sin efecto por rectificación"

#### Scenario: Asiento with the same patient text

- **GIVEN** an asiento of another receta whose `pacienteTexto` matches the paciente's name
- **WHEN** the user expands a receta
- **THEN** that asiento is not shown

### Requirement: Entrega and Archivo steps

The Entrega step SHALL show modalidad (retiro / envío), fecha, firma recibida. The Archivo step SHALL show lote nro.
and lote estado. Anulada recetas MUST show `motivoAnulacion`.

#### Scenario: Anulada receta

- **GIVEN** an ANULADA receta
- **WHEN** the user expands it
- **THEN** its `motivoAnulacion` is shown

### Requirement: Step links only with the page's permiso

Each step SHALL link to its existing detail page only when the session holds that page's permiso (`/recetas/[id]`,
`/preparaciones/[id]`, `/libro/[id]`, `/entregas/[recetaId]`, `/archivo/[id]`).

#### Scenario: Without entregas.registrar

- **GIVEN** a session without `entregas.registrar`
- **WHEN** it expands a delivered receta
- **THEN** the Entrega step has no link to `/entregas/[recetaId]`

### Requirement: Visibility per role

Each block SHALL be gated by the existing permisos listed under **Visibility per role** (no new permisos), decided
with `can()` inside the use case, never by calling other `defineQuery`s that would write `ACCESO_DENEGADO` rows.
Blocks the session cannot see MUST be omitted from the query AND the UI (not fetched then hidden).

#### Scenario: Without libro.ver

- **GIVEN** a session with `pacientes.gestionar` but without `libro.ver`
- **WHEN** it opens a Trayectoria
- **THEN** the Libro step is neither fetched nor shown
- **AND** no `ACCESO_DENEGADO` row is written

#### Scenario: Without cotizaciones.ver

- **GIVEN** a session without `cotizaciones.ver`
- **WHEN** it opens a Trayectoria
- **THEN** no presupuesto is fetched nor shown

### Requirement: No receta física

Receta física no longer exists (client decision, 2026-10-01): there SHALL be no "Receta física" data in the receta
row, no "recetas físicas adeudadas" counter (nor its days-pending value), no use of `etiquetaRecepcionReceta`.

#### Scenario: Opening a Trayectoria

- **WHEN** the user opens a paciente's Trayectoria
- **THEN** no receta física data nor "recetas físicas adeudadas" counter is shown

### Requirement: Archivo and Entrega states

The journey SHALL be Ingreso -> Preparación -> Libro -> Entrega -> Archivo. Archivo MUST be COMPLETO with a lote,
PENDIENTE otherwise; Entrega "en curso" only means an ENVIO still waiting for its firma.

#### Scenario: Receta without lote

- **WHEN** a receta has no archivo lote
- **THEN** its Archivo step is PENDIENTE

#### Scenario: Envío waiting for its firma

- **GIVEN** an ENVIO entrega with no firma recibida
- **WHEN** the receta is expanded
- **THEN** its Entrega step is "en curso"

### Requirement: Explicit select on receta

`schema.prisma` still declares the dropped receta física fields (cleanup owned by the other developer), so every
Prisma read touching `receta` here MUST use an explicit `select` (or a `groupBy` by `estado` only): a bare
`findMany`/`include` would select the missing columns and fail.

#### Scenario: Reading recetas

- **WHEN** the use case reads `receta` through Prisma
- **THEN** it uses an explicit `select` or a `groupBy` by `estado` only

## Status

Status: approved by user 2026-10-01 — implementation in progress.

## Visibility per role

Visibility per role (existing permisos, no new permisos):

| Block | Gate |
|---|---|
| Header, resumen, recetas, entrega | `pacientes.gestionar` (+ link to receta needs `recetas.crear`; entrega link needs `entregas.registrar`) |
| Presupuesto | `cotizaciones.ver` |
| Preparación, Libro | `preparaciones.iniciar` / `libro.ver` respectively |
| Archivo | `archivo.lotes.gestionar` |

## Technical design

- One use case `getTrayectoriaPaciente` in `modules/pacientes/application/`,
  a `defineQuery` gated on `pacientes.gestionar`. Inside, it uses `can()`
  to decide which optional blocks to load — it must NOT call other
  `defineQuery`s that would write `ACCESO_DENEGADO` rows.
- Batched reads (no N+1): one query for the recetas page, then
  `IN (...)` queries for items/componentes, latest cotizaciones,
  preparaciones, asientos, entregas, lotes. Every query scoped by
  `tenantId` (from session) like the rest of the repositories.
- Pure mapping/derivation (journey steps, resumen, visual asiento state,
  presupuesto sum) in a domain file so it is unit-testable.
- No logging of paciente fields. Reads are not audited (project convention).

## Database

- Migration `0051_trayectoria_paciente_indices`: additive indexes only, no
  data or column changes:
  - `receta (tenant_id, paciente_id)`
  - `item_receta (tenant_id, receta_id)`
  - `preparacion (tenant_id, item_receta_id)`
  (exact columns adjusted to the real schema/existing indexes).
- Rollback: `prisma/rollbacks/0051_trayectoria_paciente_indices.down.sql`
  plus the steps in `docs/rollbacks/trayectoria-paciente.md`.

## Receta física removed (2026-10-01)

The client decided that receta física no longer exists as a concept. Another
developer's migration `20261001090000_0051_drop_receta_fisica` (applied to the
shared DB, not part of this repo) dropped `fsj.receta.receta_fisica_recibida`,
`receta_fisica_recibida_en`, `receta_fisica_recibida_por_id` and the permisos
`recetas.fisica.registrar` / `regularizacion.ver`. Consequences here:

- No "Receta física" data in the receta row, no "recetas físicas adeudadas"
  counter (nor its days-pending value), no use of `etiquetaRecepcionReceta`.
- The journey is Ingreso -> Preparación -> Libro -> Entrega -> Archivo.
  Archivo is COMPLETO with a lote, PENDIENTE otherwise; Entrega "en curso" only
  means an ENVIO still waiting for its firma.
- `schema.prisma` still declares the dropped fields (cleanup owned by the other
  developer), so every Prisma read touching `receta` here uses an explicit
  `select` (or a `groupBy` by `estado` only): a bare `findMany`/`include` would
  select the missing columns and fail.

## Out of scope (v1)

- Global cross-receta timeline (the per-card journey already tells it).
- Paciente audit log (full PII diffs; `auditoria.ver` only).
- `AsientoHistorico` (pre-system, free-text patient, not reliably linkable; the table was removed by migration 0084).
- Stock movements / partidas consumed.
