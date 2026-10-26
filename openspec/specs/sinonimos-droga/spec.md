# Sinónimos de droga

## Purpose

A substance is **one droga** (one id). Stock, partidas, costs, recetas and the libros already hang from `droga_id`,
so a second droga for the same substance ("Vaselina" and "Petrolato") splits its stock and its history. Its other
names are **synonyms** of that droga, never drogas of their own. Implemented 2026-10-07 (see Status).

Out of scope: merging drogas that are already duplicated.

## Requirements

### Requirement: R1 — Names compare normalized

Names SHALL compare **normalized**: no accents, no case, whitespace collapsed and trimmed ("Cafeína" = "cafeina").

#### Scenario: Accent-insensitive search

- **GIVEN** a droga "Cafeína"
- **WHEN** the user types `cafeina`
- **THEN** "Cafeína" is found, with no hint

### Requirement: R2 — One vigente droga per normalized name

Within a tenant, no two **vigente** drogas SHALL share a normalized name.

#### Scenario: Same name without the accent

- **GIVEN** a vigente droga "Cafeína"
- **WHEN** the user creates a droga "Cafeina"
- **THEN** it is refused with `«Cafeína» ya es el nombre de otra droga.`

### Requirement: R3 — One droga per synonym

No two **vigente** synonyms SHALL share a normalized form (one synonym → one droga).

#### Scenario: Synonym already held by another droga

- **GIVEN** "Petrolato" is a vigente synonym of "Vaselina sólida"
- **WHEN** the user adds the synonym "petrolato" to another droga
- **THEN** it is refused on that synonym's field

### Requirement: R4 — A synonym is never a droga name

A vigente synonym SHALL never equal a vigente droga's normalized name, and vice versa (a droga insert, rename or
reactivation MUST NOT take a vigente synonym).

#### Scenario: Creating a droga named like a synonym

- **GIVEN** "Petrolato" is a vigente synonym of "Vaselina sólida"
- **WHEN** the user creates a droga "petrolato"
- **THEN** a field error on Nombre reads `«Petrolato» ya es otro nombre de Vaselina sólida.`

#### Scenario: Adding a synonym that is a droga name

- **GIVEN** vigente drogas "Vaselina sólida" and "Petrolato"
- **WHEN** the user adds the synonym "vaselina sólida" to "Petrolato"
- **THEN** a field error marks the synonym
- **AND** the typed text stays in the box

### Requirement: R5 — Soft delete, one-way

A synonym SHALL be removed with a soft delete (`fecha_baja`) and stays removed: adding the text again creates a new
row (for this or another droga).

#### Scenario: Removed synonym becomes a droga

- **GIVEN** "Petrolato" is a synonym of "Vaselina sólida"
- **WHEN** the user removes it and then creates a droga "Petrolato"
- **THEN** the creation is allowed

### Requirement: R6 — Baja removes the synonyms

Giving a droga de baja SHALL remove its vigente synonyms, in the same transaction. **Reactivating it MUST NOT
restore them.**

#### Scenario: Baja and reactivation

- **GIVEN** "Vaselina sólida" with synonym "Petrolato"
- **WHEN** "Vaselina sólida" is given de baja and later reactivated
- **THEN** "Petrolato" is removed and does not come back
- **AND** meanwhile "Petrolato" can be a new droga or another droga's synonym

### Requirement: R7 — No new synonyms on a droga de baja

A droga dada de baja SHALL take no new synonyms.

#### Scenario: Editing a droga de baja

- **GIVEN** a droga dada de baja
- **WHEN** an edit adds a synonym to it
- **THEN** the edit is rejected

### Requirement: R8 — Reactivation with a taken name

Reactivating a droga whose name is now taken (by another droga or a synonym) SHALL be refused with a readable
message.

#### Scenario: Name now held by a synonym

- **GIVEN** a droga "Petrolato" de baja, and "Petrolato" now a vigente synonym of "Vaselina sólida"
- **WHEN** the user reactivates "Petrolato"
- **THEN** it is refused with a readable message

### Requirement: R9 — Canonical name in outputs

Libro recetario, libros contralor, fichas, etiquetas, PDFs, cotizaciones and stock listings/kardex SHALL keep the
**canonical** `droga.nombre`. The droga (`droga_id`) MUST always be what is picked and stored; the synonym a droga
was picked by is only shown in the data-entry screens (see **Nombre elegido al cargar**).

#### Scenario: Picking through a synonym

- **GIVEN** droga "Vaselina sólida" with synonym "Petrolato"
- **WHEN** the user types `petro` in the receta picker and picks the option
- **THEN** the picker shows `Vaselina sólida ≈ Petrolato`
- **AND** the droga is stored, and the receta, ficha and libro read "Vaselina sólida"

### Requirement: R10 — Chosen name kept on entry

A droga picked through a synonym SHALL keep showing that synonym as the name entered, with the canonical name as a
quiet hint. Receta componentes MUST store it (`componente_item_receta.droga_alias_id`); ingreso de partidas only
displays it (see **Nombre elegido al cargar**).

#### Scenario: Receta picked through a synonym

- **GIVEN** droga "Paracetamol" with synonym "Acetaminofén"
- **WHEN** in the receta form the user types `acetam` and picks it
- **THEN** the componente's field shows `Acetaminofén ≈ Paracetamol`
- **AND** after saving, `/recetas/[id]`, its edit form and the preparaciones workspace show `Acetaminofén ≈ Paracetamol`
- **AND** the ficha técnica, the libro recetario and the etiqueta read "Paracetamol"

#### Scenario: Ingreso de partidas

- **WHEN** in `/partidas/ingresar` the user types `acetam` in a lote's droga and picks it
- **THEN** the field shows `Acetaminofén ≈ Paracetamol`
- **AND** the partida is stored for Paracetamol and `/stock` lists "Paracetamol"

### Requirement: Readable messages

The messages SHALL be those listed under **Messages** (field `nombre` when creating/renaming, `sinonimo` when adding
a synonym). The DB codes are translated in `shared/errors/mensajes-invariantes.ts`; a unique-index violation MUST
surface as the generic `ConflictError` ("Ya existe un registro con esos mismos datos."), which only a race past the
app checks can reach.

#### Scenario: Race past the app checks

- **WHEN** two saves race past the app checks and one hits a unique index
- **THEN** it fails with "Ya existe un registro con esos mismos datos."

### Requirement: Synonyms are part of the droga form

Synonyms SHALL have no use cases of their own: they are part of the droga form and are saved by `crearDroga` /
`editarDroga` (one way to add other names, on alta and on edición). `drogas.ver` returns the droga's vigente
`sinonimos`. `crearDroga` / `editarDroga` / `reactivarDroga` MUST check R2 + R4 against drogas **and** synonyms.

#### Scenario: Reading a droga

- **WHEN** `drogas.ver` returns a droga
- **THEN** it carries the droga's vigente `sinonimos`

### Requirement: Synonyms on alta

`crearDroga` SHALL also take `sinonimos: string[]` (positional, blanks skipped): the alta registers the droga's other
names in the same transaction. Each one MUST be checked before the droga is inserted (not the new name itself, not
repeated, not held by any vigente droga or synonym) and rejected on its own field `sinonimo-<i>`; each is audited as
its own `droga_alias` row.

#### Scenario: Alta with two other names

- **WHEN** the user creates "Vaselina sólida" with Otros nombres "Petrolato" and "Vaselina filante"
- **THEN** one droga and two synonyms are created, with three audit rows

#### Scenario: One other name already taken

- **GIVEN** "Petrolato" is already taken
- **WHEN** the user creates "Vaselina sólida" with Otros nombres "Petrolato" and "Vaselina filante"
- **THEN** the error marks the "Petrolato" row, everything typed is kept and nothing is created

### Requirement: Synonyms on edición

`editarDroga` SHALL take the same rows plus `sinonimosCargados` (ids of the synonyms the form showed); omitted =
synonyms untouched. A row matching a vigente synonym of the droga keeps it; a loaded synonym no row keeps MUST be
given de baja (audit `droga_alias` BAJA); a new text is added (same checks as on alta, audit `droga_alias` CREAR).

#### Scenario: Removing a loaded synonym

- **GIVEN** the form loaded the synonym "Petrolato"
- **WHEN** the user blanks its row and saves
- **THEN** "Petrolato" is given de baja with a `droga_alias` BAJA audit row

### Requirement: Concurrent synonyms and renaming to a synonym

Synonyms added by someone else after the form loaded SHALL never be removed. Removals MUST run before the name check,
so a droga can be renamed to one of its own synonyms in the same save. The droga's own audit row carries `sinonimos`
before/after.

#### Scenario: Synonym added meanwhile

- **GIVEN** another user added a synonym after the form loaded
- **WHEN** the form is saved
- **THEN** that synonym is kept

#### Scenario: Renaming to its own synonym

- **GIVEN** droga "Vaselina sólida" with synonym "Petrolato"
- **WHEN** the user removes "Petrolato" and renames the droga "Petrolato" in the same save
- **THEN** the save succeeds

### Requirement: Same form on alta and edición

Alta (`/catalogos/drogas?nueva=1`) and edición (`/catalogos/drogas/[id]`) SHALL use the same form
(`modules/drogas/ui/droga-form.tsx`), with the same "Otros nombres" rows in both; on edición they MUST start with the
droga's vigente synonyms and the droga itself is ignored by the live checks (the name is only checked when it
changes).

#### Scenario: Opening the edición

- **WHEN** the user opens a droga with two vigente synonyms
- **THEN** the "Otros nombres" rows start with those two synonyms
- **AND** the droga's unchanged name raises no live-check notice

### Requirement: Live duplicate check

From 3 characters, the typed name SHALL be searched (debounced, `modules/drogas/ui/drogas-existentes.tsx`) with the
catalog search's rule (name or vigente synonym, accent/case-insensitive, substring, vigente or baja). Similar drogas
are listed (links open in a new tab, so the form is not lost). An exact match with a vigente droga MUST be shown in
red and disables the submit; an exact match with a baja droga suggests reactivating it.

#### Scenario: Typing a partial name

- **WHEN** the user types `vasel` in the alta's Nombre
- **THEN** "Vaselina sólida" (and any other droga containing it) is listed before saving

#### Scenario: Typing a synonym

- **WHEN** the user types `petrolato` in the alta's Nombre
- **THEN** it shows `Ya existe: Vaselina sólida ≈ petrolato` and disables "Crear droga"

### Requirement: Otros nombres rows

**Otros nombres** SHALL be optional rows (`sinonimo-0`, `sinonimo-1`, ...), each with the same live check (a short
notice when the text is already a droga or a synonym, or equals the name being created). The command MUST re-check
everything.

#### Scenario: Other name equal to the new name

- **WHEN** the user types in an Otros nombres row the same text as the name being created
- **THEN** a short notice is shown on that row

### Requirement: Imports remember equivalences

The PDF/QR receta import and the factura import SHALL keep creating synonyms through "recordar esta equivalencia"
(`modules/recetas/application/importar-receta.ts`, `modules/stock/application/importar-factura-compra.ts`): `texto`
is stored as written; a text that is already a vigente droga's name is not remembered (it already resolves by name);
a vigente synonym pointing to another droga MUST be a `ConflictError`.

#### Scenario: Factura import

- **WHEN** a factura import ticks "recordar esta equivalencia" for `PETROLATO USP`
- **THEN** the synonym `PETROLATO USP` is stored as written
- **AND** the next import of the same text resolves to that droga

### Requirement: Import lookups see vigente synonyms only

The imports' lookups (`listAliasesVigentes`, `getDrogaAlias`) SHALL only see vigente synonyms of vigente drogas —
before 0067 a remembered text whose droga was given de baja blocked that text forever.

#### Scenario: Synonym of a droga de baja

- **GIVEN** a remembered text whose droga was given de baja
- **WHEN** the same text is imported
- **THEN** it does not resolve through that synonym

### Requirement: Synonym audit

Audit: entity `droga_alias` SHALL read "sinónimo de droga"; rows MUST carry `sinonimo` and the readable `droga` name.

#### Scenario: Synonym created

- **WHEN** a synonym is created
- **THEN** its audit row reads "sinónimo de droga" and carries `sinonimo` and the `droga` name

### Requirement: One search rule

One rule SHALL apply everywhere, `shared/db/busqueda-droga.ts` (in `shared/` because the pickers live in several
modules and a module may not import another's `infrastructure/`): a droga matches when the normalized query is a
substring of `fsj.normalizar_nombre(nombre)` **or** of one of its vigente synonyms. LIKE wildcards in the query MUST
be escaped.

#### Scenario: Query with a wildcard

- **WHEN** the user searches `%`
- **THEN** it matches only names or synonyms that contain a literal `%`

### Requirement: Matched synonym and pickers

When only a synonym matched, the matched synonym's text SHALL come back with the row. Each picker and list MUST
search as listed under **Search pickers**.

#### Scenario: Match by synonym only

- **WHEN** a query matches only a droga's synonym
- **THEN** the row comes back with that synonym's text

### Requirement: Visual hint

When an option matched through a synonym, the canonical name SHALL be shown and, after it, a quiet hint:
`Vaselina sólida ≈ petrolato` (`shared/ui/sinonimo-hint.tsx`: `text-xs`, muted zinc, `title="Sinónimo"`, screen
readers hear "también conocido como petrolato"). No badge, no color. Nothing extra when the name itself matched.
Picking the option MUST always pick the canonical droga.

#### Scenario: Name matched

- **WHEN** an option matched by its own name
- **THEN** no hint is shown

### Requirement: Chosen synonym in data-entry forms

Wherever a droga is **picked in a data-entry form**, a pick made through a synonym SHALL show that synonym as the
main text, followed by the canonical name as a quiet hint: `Acetaminofén ≈ Paracetamol` (`text-xs`, muted zinc;
`title` and screen readers: "Nombre principal: Paracetamol"). Picked by the canonical name → unchanged. Picking
another droga, or clearing the field, MUST drop the synonym.

#### Scenario: Clearing the field

- **GIVEN** a field showing `Acetaminofén ≈ Paracetamol`
- **WHEN** the user clears it or picks another droga
- **THEN** the synonym is dropped

### Requirement: Stored synonym belongs to that droga

A stored synonym (`modules/recetas/application/sinonimos-componentes.ts`, used by `crearReceta`, `editarReceta`,
`importarReceta`) SHALL be a synonym of **that** droga. DB backstop: FK `(tenant_id, droga_alias_id, droga_id) →
droga_alias (tenant_id, id, droga_id)`, MATCH SIMPLE (NULL = canonical name): changing a componente's droga without
clearing or replacing its synonym MUST be rejected.

#### Scenario: Changing the droga but not the synonym

- **GIVEN** a componente stored with Paracetamol and its synonym "Acetaminofén"
- **WHEN** an edit changes its droga and keeps that synonym
- **THEN** the write is rejected

### Requirement: Stored synonym vigente or already stored

A stored synonym SHALL be vigente when written, **or** the same droga + synonym pair is already stored on the receta
being edited: a synonym removed later (`fecha_baja`) MUST stay referenced and the receta keeps showing the name it
was loaded with, also after unrelated edits. Audit: `items` carries `drogaAliasId`; `itemsResumen` reads
`Acetaminofén (Paracetamol) 500 mg`.

#### Scenario: Synonym removed after the receta

- **GIVEN** a receta stored with `Acetaminofén ≈ Paracetamol`, and "Acetaminofén" later removed from Paracetamol
- **WHEN** the user views the receta and edits another ítem
- **THEN** it still shows `Acetaminofén ≈ Paracetamol` and the edit saves fine
- **AND** picking Paracetamol again in that componente (by its name) drops the synonym

### Requirement: PDF/QR import prefill and recordar

On PDF/QR import, a componente the preview matched through a synonym (`resolverDroga` via `ALIAS`) SHALL be prefilled
with it. With **"Recordar esta equivalencia"**, the command writes the synonyms **before** the receta (same
transaction) and MUST load the componentes that showed that text with it — when the componente still has that droga
and was not already picked by another synonym (see **Nombre elegido al cargar**).

#### Scenario: Remembering an equivalence on PDF import

- **GIVEN** a PDF with "ACETAMINOFEN 500 mg" and no match
- **WHEN** the user picks Paracetamol by its name and ticks "Recordar esta equivalencia"
- **THEN** the synonym `ACETAMINOFEN` is created and that componente is saved with it (shows `ACETAMINOFEN ≈ Paracetamol`)
- **AND** the next import of the same text arrives already matched and prefilled with that synonym

## Status

Status: implemented 2026-10-07 (migrations 0067 and 0069). Rollback: `docs/rollbacks/sinonimos-droga.md`.

## Enforcement

| # | Enforced in |
|---|---|
| R1 | `modules/drogas/domain/normalizar.ts` (`normalizarTexto`, app) and `fsj.normalizar_nombre(text)` (DB, `unaccent`-based, IMMUTABLE). |
| R2 | DB: `uq_droga_nombre_normalizado_vigente` (expression index, replaces 0007's citext `uq_droga_nombre_vigente`, which was accent-sensitive). App: `existeNombreVigente` → field error on `nombre` in `crearDroga` / `editarDroga`. |
| R3 | DB: partial unique index `uq_droga_alias_vigente` (replaces 0049's plain UNIQUE). App: `crearDroga` / `editarDroga` ("Otros nombres" rows) and the imports' "recordar esta equivalencia". |
| R4 | DB: `INV-DRG-002` triggers `trg_droga_alias_validar` / `trg_droga_nombre_no_es_sinonimo`, serialized by a transaction advisory lock on (tenant, normalized name). App: same checks with readable messages. |
| R5 | DB: `INV-DRG-003`; fsj_app may UPDATE `fecha_baja` only, no DELETE. App: `editarDroga` (a loaded row removed, blanked or retyped). |
| R6 | DB: `trg_droga_baja_quita_sinonimos` (AFTER UPDATE OF fecha_baja). Migration 0067 also applies it to drogas already de baja. |
| R7 | App: `editarDroga` rejects any edit of a droga dada de baja (and the baja trigger removes its synonyms). |
| R8 | App: `reactivarDroga`; DB: R2 index / R4 trigger. |
| R9 | Unchanged code paths. |
| R10 | See "Nombre elegido al cargar". |

## Messages

Messages (field `nombre` when creating/renaming, `sinonimo` when adding a synonym):

- `«Vaselina» ya es el nombre de otra droga.`
- `«Petrolato» ya es otro nombre de Vaselina sólida.`
- Own droga: `«X» ya es el nombre de esta droga.` / `«X» ya es otro nombre de esta droga. Quitalo de «Otros nombres» si querés usarlo como nombre principal.`

## Data

`fsj.droga_alias`, migration 0067:

| Column | Note |
|---|---|
| `texto` | **New.** The synonym as typed, for display. Rows from before 0067 hold their normalized form. |
| `alias_normalizado` | Match key, written by the app with `normalizarTexto`. |
| `fecha_baja` | **New.** Soft delete, one-way. |

## Search pickers

| Picker / list | How |
|---|---|
| Receta componente (`DrogaPicker`) | `listDrogasParaReceta` (SQL fragment); name matches first. |
| `/catalogos/drogas` list and its autocomplete | `listDrogas` (`buscarDrogasPorTexto` → `id IN`). Rows show their synonyms on a muted line. |
| `/stock`, `/stock/ajustes`, ajuste nuevo, `/reportes/kardex` (`buscarDrogasStockAction`) | `listStockDrogasSql`; ajustes listing (`listAjustesSql`, also by lote); stock valorizado (`valorizado-repository.ts`). |
| `/partidas/ingresar` + factura import combobox | `listDrogasOpciones` returns `sinonimos`; `filtrarOpciones` searches them client-side. |
| Proveedor Trayectoria droga filter | Its own query `proveedores.trayectoria.sinonimos` (the screen's permiso) feeds `filtrarOpciones`. |
| Libro contralor search | **Unchanged**: it searches its own snapshot text. |

## Nombre elegido al cargar

Problem: typing "Acetaminofén" and picking the droga "Paracetamol" used to
show "Paracetamol" in the form; at a glance the user could believe
"Acetaminofén" was never loaded and load it twice. Now, wherever a droga is
**picked in a data-entry form**, a pick made through a synonym shows that
synonym as the main text, followed by the canonical name as a quiet hint:
`Acetaminofén ≈ Paracetamol` (`text-xs`, muted zinc; `title` and screen
readers: "Nombre principal: Paracetamol" — `NombrePrincipalHint` in
`shared/ui/sinonimo-hint.tsx`, and the selected value of `shared/ui/combobox.tsx`).
Picked by the canonical name → unchanged. Picking another droga, or clearing
the field, drops the synonym.

Generic part (`Combobox`): an option found through a synonym carries it as
`sinonimo`; the picked option reaches `onChange` whole, and while it is the
value the field shows `sinonimo` + the `label` as the hint. Every
client-filtered droga combobox (`filtrarOpciones` over `sinonimos`) gets it by
keeping the picked option as its value.

| Where | Kept | How |
|---|---|---|
| Receta componentes (alta, edición `/recetas/[id]/editar`, the `/preparaciones/recetas/[recetaId]` workspace form, PDF/QR import) | **Persisted** — the receta is edited later | `fsj.componente_item_receta.droga_alias_id` (migration 0069). `listDrogasParaReceta` returns the matched synonym's id + text; `DrogaPicker` keeps `{ drogaId, drogaAliasId }`. |
| Receta read views: `/recetas/[id]`, the Pendientes "Ver" preview and the toma workspace (`ComponentesTabla`) | Shown from the stored synonym | `getRecetaConItems`, `listComponentesDePendientes`, the toma read. |
| Ingreso de partidas (`/partidas/ingresar`, manual and factura import) | **Display only** | Combobox value. Partidas stay keyed by `droga_id` alone (no schema change). A factura line matched through a remembered synonym shows the invoice text with the hint. |
| Libro recetario/contralor, ficha técnica, etiquetas, PDFs, cotizaciones, stock listings/kardex | Never | Canonical `droga.nombre` (R9). |

Rules for the stored synonym (`modules/recetas/application/sinonimos-componentes.ts`,
used by `crearReceta`, `editarReceta`, `importarReceta`):

- It must be a synonym of **that** droga. DB backstop: FK
  `(tenant_id, droga_alias_id, droga_id) → droga_alias (tenant_id, id, droga_id)`,
  MATCH SIMPLE (NULL = canonical name): changing a componente's droga without
  clearing or replacing its synonym is rejected.
- It must be vigente when written, **or** the same droga + synonym pair is
  already stored on the receta being edited: a synonym removed later
  (`fecha_baja`) stays referenced and the receta keeps showing the name it was
  loaded with, also after unrelated edits.
- Audit: `items` carries `drogaAliasId`; `itemsResumen` reads
  `Acetaminofén (Paracetamol) 500 mg`.

PDF/QR import: a componente the preview matched through a synonym
(`resolverDroga` via `ALIAS`) is prefilled with it. **"Recordar esta
equivalencia"**: the client sends, with each equivalence, the positions of the
componentes that showed that text; the command writes the synonyms **before**
the receta (same transaction; their audit rows still follow the receta's) and
loads those componentes with it — when the componente still has the droga the
synonym was remembered for and was not already picked by another synonym
(a pick made in the picker wins: it is what the user saw). A text that is
already the droga's own name is not a synonym, so those componentes keep the
canonical name.
