# Pacientes recurrentes

Status: approved by user 2026-10-01 — implemented (see "Implementation notes").

Rollback: `docs/rollbacks/pacientes-recurrentes.md` (code first, then the
`prisma/rollbacks/0055_paciente_recordatorios_whatsapp.down.sql` as a new forward
migration; existing consent values are lost).

## Goal

Give visibility of patients who periodically order the same preparation, and
a one-click WhatsApp reminder ("se acerca la fecha de tu preparado de X").
The system never sends anything itself: it opens WhatsApp with a prefilled
message that a person reviews and sends.

## Routes and navigation

- `/pacientes` gets a tab bar: **Todos** (`/pacientes`, exact match) |
  **Recurrentes** (`/pacientes/recurrentes`). Reuse `app/(app)/section-tabs.tsx`
  (its `exact` flag).
- Same guard as the rest of `/pacientes/**`: `pacientes.gestionar`.
- URL carries only non-identifying params (e.g. `?ventana=` filter, `?page=`).
  No patient name/DNI/phone in our URLs (DP-24 / Ley 25.326).
- Each row links to the patient's Trayectoria (`/pacientes/[id]/trayectoria`).

## Detection (derived from existing recetas, no manual marking)

- Unit of comparison: an **item de receta**. Its **fórmula signature** is
  `formaFarmaceutica` + the sorted set of `(drogaId, cantidad, unidadMedidaId,
  modoExpresion)` of its componentes. Two items with the same signature are
  "the same thing".
- Source rows: items of non-ANULADA recetas of the tenant whose
  `fechaIngreso` is within the last 12 months. Vigente pacientes only (no
  `fechaBaja`).
- A (paciente, signature) pair is **recurrente** when it appears in **2 or
  more distinct recetas** in that window. (Constant, easy to change.)
- **Intervalo típico** = median of the day gaps between consecutive
  `fechaIngreso` of those recetas. With exactly 2 occurrences and a known
  `duracionTratamientoDias` on the latest item, that value is used instead
  (it is the prescriber's own period); otherwise the single gap.
- **Próxima fecha estimada** = last `fechaIngreso` + intervalo típico.
- **Estado** (relative to "today" in the tenant's time zone):
  - `ATRASADO`: próxima fecha already passed.
  - `ESTA_SEMANA`: próxima fecha within the next 7 days (inclusive).
  - `MAS_ADELANTE`: later.
- Default filter shows `ATRASADO` + `ESTA_SEMANA`; a filter allows "todos".
  Overdue rows older than 2× the interval are dropped (the patient
  likely stopped). Exactly: a row is dropped when `diasHastaProxima < -2 × intervalo`
  (days from today to the próxima fecha, negative when overdue). Example: a
  monthly patient (interval 30) is ATRASADO from day 31 after the last order and
  disappears from every window about 90 days after it (30 + 2 × 30, 91st day).
- Ordered by próxima fecha ascending. A patient with two recurring
  formulas shows two rows.

## View columns

Paciente (apellido, nombre) · Qué pide (forma + drogas with cantidad/unidad,
or the item `descripcion` if present) · Veces · Cada ~N días · Último pedido
· Próximo (estimated) · Estado badge · Acciones (WhatsApp, Trayectoria).

## WhatsApp

- Link: `https://wa.me/<digits>?text=<urlencoded message>`, opened in a new
  tab (`target="_blank" rel="noopener noreferrer"`).
- Phone normalization (pure function, unit tested) from the free-text
  `paciente.telefono` to Argentine WhatsApp format `549` + area code +
  number: strip non-digits, leading `00`/`+`, country `54`, the mobile `9`,
  the trunk `0` and the `15` mobile prefix after the area code; result must
  be `549` + 10 digits. Anything that cannot be normalized confidently →
  no link, show "Teléfono inválido" with a link to the patient's Datos tab.
- Message (Spanish, built from tenant farmacia name + patient first name +
  "qué pide"):
  "Hola {nombre}, te escribimos de {farmacia}. Se acerca la fecha de tu
  preparado de {formula}. ¿Querés que lo preparemos? Respondé este mensaje
  y lo coordinamos."
- The button only renders when the patient **accepted WhatsApp reminders**
  AND the phone normalizes. Otherwise show the reason ("Sin consentimiento"
  / "Sin teléfono" / "Teléfono inválido").

## Consent (DB change)

- New column `fsj.paciente.acepta_recordatorios_whatsapp boolean NOT NULL
  DEFAULT false`. Existing patients default to `false` (no consent assumed).
- Editable from the paciente form (Datos tab and alta) as a checkbox
  "Acepta recordatorios por WhatsApp". Goes through the existing
  crear/editar use cases, so it is audited like any other field and keeps
  the optimistic-concurrency version check.
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
  docs/specs/trayectoria-paciente.md).
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
