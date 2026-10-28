# Pacientes recurrentes

## Purpose

Give visibility of patients who periodically order the same preparation, and a one-click WhatsApp reminder ("se
acerca la fecha de tu preparado de X"). Approved by user 2026-10-01 (see Status).

## Requirements

### Requirement: The system never sends

The system SHALL never send anything itself: it MUST open WhatsApp with a prefilled message that a person reviews
and sends.

#### Scenario: Clicking the WhatsApp button

- **WHEN** the user clicks a row's WhatsApp button
- **THEN** WhatsApp opens with the prefilled message
- **AND** nothing is sent until the person sends it

### Requirement: Todos and Recurrentes tabs

`/pacientes` SHALL get a tab bar: **Todos** (`/pacientes`, exact match) | **Recurrentes** (`/pacientes/recurrentes`),
reusing `app/(app)/section-tabs.tsx` (its `exact` flag).

#### Scenario: On the Recurrentes tab

- **WHEN** the user is on `/pacientes/recurrentes`
- **THEN** the Recurrentes tab is active and Todos is not

### Requirement: Guard pacientes.gestionar

The view SHALL have the same guard as the rest of `/pacientes/**`: `pacientes.gestionar`.

#### Scenario: Session without pacientes.gestionar

- **GIVEN** a session without `pacientes.gestionar`
- **WHEN** it opens `/pacientes/recurrentes`
- **THEN** the guard refuses it

### Requirement: Nothing identifying in our URLs

The URL SHALL carry only non-identifying params (e.g. `?ventana=` filter, `?page=`). No patient name/DNI/phone MUST
appear in our URLs (DP-24 / Ley 25.326).

#### Scenario: Filtering the window

- **WHEN** the user changes the filter
- **THEN** the URL carries only `ventana` and `page`, no patient name, DNI or phone

### Requirement: Link to the Trayectoria

Each row SHALL link to the patient's Trayectoria (`/pacientes/[id]/trayectoria`).

#### Scenario: Opening a patient's journey

- **WHEN** the user clicks a row's Trayectoria action
- **THEN** `/pacientes/[id]/trayectoria` of that patient opens

### Requirement: Fórmula signature

Recurrence SHALL be derived from existing recetas, with no manual marking. The unit of comparison MUST be an **item
de receta**; its **fórmula signature** is `formaFarmaceutica` + the sorted set of `(drogaId, cantidad,
unidadMedidaId, modoExpresion)` of its componentes. Two items with the same signature are "the same thing".

#### Scenario: Same componentes in another order

- **GIVEN** two items with the same forma and the same componentes entered in a different order
- **WHEN** recurrence is detected
- **THEN** both items have the same signature

#### Scenario: Different cantidad

- **GIVEN** two items with the same forma and drogas but a different `cantidad`
- **WHEN** recurrence is detected
- **THEN** they are not the same signature

### Requirement: Source rows

The source rows SHALL be the items of non-ANULADA recetas of the tenant whose `fechaIngreso` is within the last 12
months, of vigente pacientes only (no `fechaBaja`).

#### Scenario: Anulada receta

- **WHEN** one of a patient's recetas is ANULADA
- **THEN** its items do not count

#### Scenario: Paciente dado de baja

- **GIVEN** a paciente with `fechaBaja`
- **WHEN** recurrence is detected
- **THEN** no row is shown for that paciente

### Requirement: Recurrente

A (paciente, signature) pair SHALL be **recurrente** when it appears in **2 or more distinct recetas** in that
window. (Constant, easy to change.)

#### Scenario: Two recetas in the window

- **GIVEN** two distinct recetas in the last 12 months with an item of the same signature for one paciente
- **WHEN** the view is computed
- **THEN** the pair is recurrente

#### Scenario: One receta

- **GIVEN** only one receta with that signature in the window
- **WHEN** the view is computed
- **THEN** the pair is not recurrente

### Requirement: Intervalo típico

The **intervalo típico** SHALL be the median of the day gaps between consecutive `fechaIngreso` of those recetas.
With exactly 2 occurrences and a known `duracionTratamientoDias` on the latest item, that value MUST be used instead
(it is the prescriber's own period); otherwise the single gap.

#### Scenario: Three occurrences

- **GIVEN** three occurrences with gaps of 28 and 32 days
- **WHEN** the interval is computed
- **THEN** it is the median of the gaps, 30

#### Scenario: Two occurrences with duración de tratamiento

- **GIVEN** two occurrences 40 days apart and `duracionTratamientoDias` 30 on the latest item
- **WHEN** the interval is computed
- **THEN** it is 30

#### Scenario: Two occurrences without duración

- **GIVEN** two occurrences 40 days apart and no `duracionTratamientoDias` on the latest item
- **WHEN** the interval is computed
- **THEN** it is 40

### Requirement: Próxima fecha estimada

The **próxima fecha estimada** SHALL be the last `fechaIngreso` + intervalo típico.

#### Scenario: Monthly patient

- **GIVEN** a last `fechaIngreso` of 2026-10-01 and an interval of 30
- **WHEN** the row is computed
- **THEN** the próxima fecha is 2026-10-31

### Requirement: Estado

The **estado**, relative to "today" in the tenant's time zone, SHALL be: `ATRASADO` when the próxima fecha already
passed; `ESTA_SEMANA` when it is within the next 7 days (inclusive); `MAS_ADELANTE` when later.

#### Scenario: Seven days ahead

- **WHEN** the próxima fecha is 7 days from today
- **THEN** the estado is `ESTA_SEMANA`

#### Scenario: Eight days ahead

- **WHEN** the próxima fecha is 8 days from today
- **THEN** the estado is `MAS_ADELANTE`

#### Scenario: Passed

- **WHEN** the próxima fecha was yesterday
- **THEN** the estado is `ATRASADO`

### Requirement: Default filter

The default filter SHALL show `ATRASADO` + `ESTA_SEMANA`; a filter MUST allow "todos".

#### Scenario: Opening the view

- **WHEN** the user opens the view with no filter
- **THEN** only `ATRASADO` and `ESTA_SEMANA` rows are shown

#### Scenario: Todos

- **WHEN** the user picks "todos"
- **THEN** `MAS_ADELANTE` rows are shown too

### Requirement: Stopped patients dropped

Overdue rows older than 2× the interval SHALL be dropped (the patient likely stopped). Exactly: a row MUST be dropped
when `diasHastaProxima < -2 × intervalo` (days from today to the próxima fecha, negative when overdue).

#### Scenario: Monthly patient who stopped

- **GIVEN** a monthly patient (interval 30)
- **WHEN** days pass after the last order
- **THEN** the row is ATRASADO from day 31 after the last order
- **AND** it disappears from every window about 90 days after it (30 + 2 × 30, 91st day)

### Requirement: Order and one row per fórmula

Rows SHALL be ordered by próxima fecha ascending. A patient with two recurring formulas MUST show two rows.

#### Scenario: Two formulas

- **GIVEN** a patient with two recurring fórmula signatures
- **WHEN** the view is computed
- **THEN** the patient appears in two rows, each placed by its own próxima fecha

### Requirement: View columns

The view SHALL show the columns: Paciente (apellido, nombre) · Qué pide (forma + drogas with cantidad/unidad, or the
item `descripcion` if present) · Veces · Cada ~N días · Último pedido · Próximo (estimated) · Estado badge ·
Acciones (WhatsApp, Trayectoria).

#### Scenario: Item with a descripcion

- **GIVEN** a recurrent item with a `descripcion`
- **WHEN** it is listed
- **THEN** Qué pide shows the `descripcion`

### Requirement: WhatsApp link

The link SHALL be `https://wa.me/<digits>?text=<urlencoded message>`, opened in a new tab (`target="_blank"
rel="noopener noreferrer"`).

#### Scenario: Opening the link

- **WHEN** the user clicks the WhatsApp button
- **THEN** `https://wa.me/<digits>?text=<urlencoded message>` opens in a new tab

### Requirement: Phone normalization

A pure function (unit tested) SHALL normalize the free-text `paciente.telefono` to the Argentine WhatsApp format
`549` + area code + number: strip non-digits, leading `00`/`+`, country `54`, the mobile `9`, the trunk `0` and the
`15` mobile prefix after the area code; the result MUST be `549` + 10 digits.

#### Scenario: Number with trunk and 15

- **WHEN** `paciente.telefono` is `0261 15 412-3456`
- **THEN** it normalizes to `5492614123456`

### Requirement: Phone that cannot be normalized

Anything that cannot be normalized confidently SHALL get no link and MUST show "Teléfono inválido" with a link to
the patient's Datos tab.

#### Scenario: Phone without area code

- **WHEN** `paciente.telefono` is `15 2345 6789`
- **THEN** the row has no WhatsApp link and shows "Teléfono inválido" with a link to the Datos tab

### Requirement: Message

The message SHALL be in Spanish, built from the tenant farmacia name + patient first name + "qué pide": "Hola
{nombre}, te escribimos de {farmacia}. Se acerca la fecha de tu preparado de {formula}. ¿Querés que lo
preparemos? Respondé este mensaje y lo coordinamos."

#### Scenario: Building the message

- **GIVEN** the farmacia "San Jorge", a patient named Ana and a fórmula "cápsulas de cafeína 100 mg"
- **WHEN** the link is built
- **THEN** the text reads "Hola Ana, te escribimos de San Jorge. Se acerca la fecha de tu preparado de cápsulas de cafeína 100 mg. ¿Querés que lo preparemos? Respondé este mensaje y lo coordinamos."

### Requirement: Button only with consent and a valid phone

The button SHALL only render when the patient **accepted WhatsApp reminders** AND the phone normalizes. Otherwise it
MUST show the reason ("Sin consentimiento" / "Sin teléfono" / "Teléfono inválido").

#### Scenario: No consent

- **GIVEN** a patient with a valid phone who did not accept WhatsApp reminders
- **WHEN** the row is shown
- **THEN** there is no WhatsApp button and the row reads "Sin consentimiento"

#### Scenario: No phone

- **GIVEN** a patient who accepted the reminders and has no phone
- **WHEN** the row is shown
- **THEN** there is no WhatsApp button and the row reads "Sin teléfono"

### Requirement: Consent column

A new column `fsj.paciente.acepta_recordatorios_whatsapp boolean NOT NULL DEFAULT false` SHALL hold the consent.
Existing patients MUST default to `false` (no consent assumed).

#### Scenario: Patient created before the column

- **GIVEN** a patient that existed before the migration
- **WHEN** the column is added
- **THEN** the patient's consent is `false`

### Requirement: Consent in the paciente form

The consent SHALL be editable from the paciente form (Datos tab and alta) as a checkbox "Acepta recordatorios por
WhatsApp". It MUST go through the existing crear/editar use cases, so it is audited like any other field and keeps
the optimistic-concurrency version check.

#### Scenario: Recording the consent

- **WHEN** the user ticks "Acepta recordatorios por WhatsApp" in the paciente's Datos tab and saves
- **THEN** the consent is stored and audited like any other field

#### Scenario: Stale form

- **GIVEN** the paciente was edited by someone else after the form loaded
- **WHEN** the user saves the consent
- **THEN** the optimistic-concurrency version check refuses the save

## Status

Status: approved by user 2026-10-01 — implemented (see "Implementation notes").

Rollback: `docs/rollbacks/pacientes-recurrentes.md` (code first, then the
`prisma/rollbacks/0055_paciente_recordatorios_whatsapp.down.sql` as a new forward
migration; existing consent values are lost).

## Database

- Migration `0055_paciente_recordatorios_whatsapp` (next free number after
  the other developer's migrations, which are not in this repo:
  `20261001090000_0051_drop_receta_fisica`, 0052_regla_precio_tramos, 0053 and
  `20261001110100_0054`; this repo has its own
  `20261001100000_0051_trayectoria_paciente_indices`): additive only + whatever
  column-level GRANT the paciente table pattern requires for `fsj_app`.
- Rollback: `prisma/rollbacks/0055_paciente_recordatorios_whatsapp.down.sql`
  + `docs/rollbacks/pacientes-recurrentes.md`.

## Technical design

- Use case `listPacientesRecurrentes` in `modules/pacientes/application/`,
  `defineQuery` on `pacientes.gestionar`. Returns rows already computed.
- Repository: one batched read of the window's items + componentes + receta
  fecha + paciente (explicit `select` everywhere — `schema.prisma` still
  declares receta columns that were dropped from the shared DB; see
  openspec/specs/trayectoria-paciente/spec.md).
- Pure domain (`modules/pacientes/domain/recurrentes.ts`): signature,
  grouping, median interval, próxima fecha, estado, phone normalization,
  message builder. Unit tested.
- No logging of patient fields; reads not audited (project convention).

## Implementation notes

Decisions where the spec was silent or where the implementation is stricter.

Detection
- **Signature** keeps duplicated componentes (sorted multiset, not a set), and
  compares `cantidad` as a number (`0.50` = `0.5`; the `numeric` column keeps the
  scale that was typed). `descripcion` and `cantidadUnidades` are not part of it.
- **Calendar days** (intervals, próxima fecha, "today") are computed in the
  tenant's zone with `jornadaDe`; the 12-month window starts at local midnight of
  today minus 12 calendar months (day clamped: 31 Mar - 1 month = 28/29 Feb).
- **Median of an even number of gaps** rounds half up (30.5 -> 31).
- **Same-day duplicates are collapsed** before counting `veces` and gaps: recetas
  of one (paciente, fórmula) pair that fall on the same calendar day of the tenant
  are ONE occurrence (the latest of that day is the one reported). Days 0, 0 and
  30 are 2 occurrences with a 30-day interval, not 3 occurrences "every ~15 days".
  Two recetas on the same day are therefore not a recurrence by themselves.
- The "**drop overdue older than 2x the interval**" rule applies to every window,
  `todos` included (overdue by exactly 2x is kept).
- ANULADA recetas and pacientes with `fechaBaja` are filtered in the query AND
  ignored by the domain function, so the rule holds for any caller.
- "Qué pide" for a row is taken from the **latest** receta of the group.

WhatsApp
- **Phone normalization** (`normalizarTelefonoWhatsappAR`): drop a trailing
  extension (`int 15`, `interno 204`, `x12`), keep the digits, drop the international
  prefix (a `+` or `00` MUST be followed by `54`, any other country is invalid;
  without them a leading `54` is dropped anyway), the mobile `9` and the trunk `0`.
  What remains is the national number: 10 digits (area + number) or 12 digits (area
  + `15` + number, the `15` removed only at its unambiguous position for an 11,
  3-digit or 4-digit area); anything else is invalid. It must start with `11`, `2x`
  or `3x`. Result: `549` + 10 digits.
  - Formats WITHOUT `9` or `15` (`11 2345 6789`, `+54 11 4123 4567`,
    `011 4123-4567`) are accepted: they are the most common way to write a number,
    and a landline cannot be told apart from a mobile. The consent flag and the
    person reviewing the message before sending it are the safeguard.
  - Invalid on purpose: `15 2345 6789` (mobile prefix without area code, the area is
    unknown), 8-digit local numbers, 9 or 11 digits, areas starting with 4 to 9,
    foreign numbers, `0800`, and a field holding TWO numbers (`11 1234 5678 / 11 8765
    4321`: it cannot be split confidently, the person fixes it in the Datos tab).
- The free-text `descripcion` shown as "qué pide" is capped at 120 characters (an
  ellipsis marks the cut) because it goes into the WhatsApp message and URL.
- Reason precedence: `SIN_CONSENTIMIENTO`, then `SIN_TELEFONO`, then
  `TELEFONO_INVALIDO`.
- Message: the forma is lower-cased inside the sentence ("tu preparado de cápsula
  de ..."); if the fórmula text already ends with a period, none is added. The
  wording is otherwise the approved one. The patient's `nombre` field is used as is.
- The raw `telefono` never leaves the use case: rows carry the `wa.me` URL (phone
  + message, by design) or the reason. Not logged, not stored.

Consent
- Only `pacientes.crear` (the pacientes form, `pacientes.gestionar`) can record the
  consent: it uses `crearPacienteConConsentimientoInput`. The exported
  `crearPacienteInput` keeps its original shape WITHOUT the field and is what the
  receta flow reuses (`pacientes.crear-desde-receta`, and the PDF import on
  client-supplied JSON): a user with only `recetas.crear` cannot record an opt-in
  there (zod strips the key, `crearPacienteHandler` always stores `false`).
  `crear` defaults the flag to `false` when absent. `editar` takes it as a **required**
  boolean plus its `version` copy, so an omitted value can never silently revoke
  a consent. The form sends an unchecked box as an explicit `false`.

UI / routing
- The "Todos | Recurrentes" tabs are rendered by each of the two list pages through
  `app/(app)/pacientes/pacientes-tabs.tsx`, not by `pacientes/layout.tsx`, so they
  never show under `/pacientes/[id]/**`. "Todos" is `exact`.
- `/pacientes/recurrentes` (static) is matched before `/pacientes/[id]`: Next's
  route sorting puts static segments first, so the `[id]` uuid guard never sees it.
- The estado badge is local to the pacientes UI (`ui/recurrentes-tabla.tsx`); the
  shared `StatusBadge` was not extended.
- `shared/labels/field-labels.ts` got two entries (`aceptaRecordatoriosWhatsapp`,
  `ventana`): the completeness guard in `usecase-registry-all-modules.test.ts`
  requires a label for every use-case input key, and the audit diff uses the
  first one.

Deployment
- **APPLY 0055 BEFORE deploying this code.** Without the column: the `/pacientes`
  list still works (explicit select); `/pacientes/[id]`, create and edit paciente
  (and baja/reactivación, which read through the same function),
  `/pacientes/recurrentes` and every `paciente.create` (including the receta
  quick-create and the PDF import, because Prisma sends the defaulted column) fail
  with "column does not exist".
- The read loads the names and phones of every paciente with items in the window
  (not only recurrent ones) in one query, as specified; there is no row cap. Fine
  for a single pharmacy; revisit if a tenant ever has tens of thousands of items
  per year.

## Out of scope (v1)

- Recording "ya contactado este mes" (needs its own table).
- Sending messages from the server / WhatsApp Business API.
- Detecting "similar but not identical" formulas.
