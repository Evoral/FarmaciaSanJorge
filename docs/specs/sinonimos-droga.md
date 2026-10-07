# Sinónimos de droga

Status: implemented 2026-10-07 (migrations 0067 and 0069). Rollback: `docs/rollbacks/sinonimos-droga.md`.

## Goal

A substance is **one droga** (one id). Stock, partidas, costs, recetas and the
libros already hang from `droga_id`, so a second droga for the same substance
("Vaselina" and "Petrolato") splits its stock and its history. Its other names
are **synonyms** of that droga, never drogas of their own.

Out of scope: merging drogas that are already duplicated.

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | Names compare **normalized**: no accents, no case, whitespace collapsed and trimmed ("Cafeína" = "cafeina"). | `modules/drogas/domain/normalizar.ts` (`normalizarTexto`, app) and `fsj.normalizar_nombre(text)` (DB, `unaccent`-based, IMMUTABLE). |
| R2 | Within a tenant, no two **vigente** drogas share a normalized name. | DB: `uq_droga_nombre_normalizado_vigente` (expression index, replaces 0007's citext `uq_droga_nombre_vigente`, which was accent-sensitive). App: `existeNombreVigente` → field error on `nombre` in `crearDroga` / `editarDroga`. |
| R3 | No two **vigente** synonyms share a normalized form (one synonym → one droga). | DB: partial unique index `uq_droga_alias_vigente` (replaces 0049's plain UNIQUE). App: `crearDroga` / `editarDroga` ("Otros nombres" rows) and the imports' "recordar esta equivalencia". |
| R4 | A vigente synonym never equals a vigente droga's normalized name, and vice versa (a droga insert, rename or reactivation cannot take a vigente synonym). | DB: `INV-DRG-002` triggers `trg_droga_alias_validar` / `trg_droga_nombre_no_es_sinonimo`, serialized by a transaction advisory lock on (tenant, normalized name). App: same checks with readable messages. |
| R5 | A synonym is removed with a soft delete (`fecha_baja`) and stays removed: adding the text again creates a new row (for this or another droga). | DB: `INV-DRG-003`; fsj_app may UPDATE `fecha_baja` only, no DELETE. App: `editarDroga` (a loaded row removed, blanked or retyped). |
| R6 | Giving a droga de baja removes its vigente synonyms, in the same transaction. **Reactivating it does not restore them.** | DB: `trg_droga_baja_quita_sinonimos` (AFTER UPDATE OF fecha_baja). Migration 0067 also applies it to drogas already de baja. |
| R7 | A droga dada de baja takes no new synonyms. | App: `editarDroga` rejects any edit of a droga dada de baja (and the baja trigger removes its synonyms). |
| R8 | Reactivating a droga whose name is now taken (by another droga or a synonym) is refused with a readable message. | App: `reactivarDroga`; DB: R2 index / R4 trigger. |
| R9 | Libro recetario, libros contralor, fichas, etiquetas, PDFs, cotizaciones and stock listings/kardex keep the **canonical** `droga.nombre`. The droga (`droga_id`) is always what is picked and stored; the synonym a droga was picked by is only shown in the data-entry screens (see "Nombre elegido al cargar"). | Unchanged code paths. |
| R10 | A droga picked through a synonym keeps showing that synonym as the name entered, with the canonical name as a quiet hint. Receta componentes store it (`componente_item_receta.droga_alias_id`); ingreso de partidas only displays it. | See "Nombre elegido al cargar". |

Messages (field `nombre` when creating/renaming, `sinonimo` when adding a synonym):

- `«Vaselina» ya es el nombre de otra droga.`
- `«Petrolato» ya es otro nombre de Vaselina sólida.`
- Own droga: `«X» ya es el nombre de esta droga.` / `«X» ya es otro nombre de esta droga. Quitalo de «Otros nombres» si querés usarlo como nombre principal.`

The DB codes are translated in `shared/errors/mensajes-invariantes.ts`; a
unique-index violation surfaces as the generic `ConflictError` ("Ya existe un
registro con esos mismos datos."), which only a race past the app checks can reach.

## Data (`fsj.droga_alias`, migration 0067)

| Column | Note |
|---|---|
| `texto` | **New.** The synonym as typed, for display. Rows from before 0067 hold their normalized form. |
| `alias_normalizado` | Match key, written by the app with `normalizarTexto`. |
| `fecha_baja` | **New.** Soft delete, one-way. |

## Use cases (`modules/drogas`)

Synonyms have no use cases of their own: they are part of the droga form and
are saved by `crearDroga` / `editarDroga` (one way to add other names, on alta
and on edición).
- `drogas.ver` now returns the droga's vigente `sinonimos`.
- `crearDroga` / `editarDroga` / `reactivarDroga`: R2 + R4 checked against drogas **and** synonyms.
- `crearDroga` also takes `sinonimos: string[]` (positional, blanks skipped): the
  alta registers the droga's other names in the same transaction. Each one is
  checked before the droga is inserted (not the new name itself, not repeated,
  not held by any vigente droga or synonym) and rejected on its own field
  `sinonimo-<i>`; each is audited as its own `droga_alias` row.
- `editarDroga` takes the same rows plus `sinonimosCargados` (ids of the
  synonyms the form showed); omitted = synonyms untouched. A row matching a
  vigente synonym of the droga keeps it; a loaded synonym no row keeps is given
  de baja (audit `droga_alias` BAJA); a new text is added (same checks as on
  alta, audit `droga_alias` CREAR). Synonyms added by someone else after the
  form loaded are never removed. Removals run before the name check, so a droga
  can be renamed to one of its own synonyms in the same save. The droga's own
  audit row carries `sinonimos` before/after.

### Droga form (alta `/catalogos/drogas?nueva=1` and edición `/catalogos/drogas/[id]`, `modules/drogas/ui/droga-form.tsx`)

Same form, same "Otros nombres" rows in both; on edición they start with the
droga's vigente synonyms and the droga itself is ignored by the live checks
(the name is only checked when it changes).


- **Live duplicate check** (`modules/drogas/ui/drogas-existentes.tsx`): from 3
  characters, the typed name is searched (debounced) with the same rule as the
  catalog search — name or vigente synonym, accent/case-insensitive, substring,
  vigente or baja. Similar drogas are listed (links open in a new tab, so the
  form is not lost). An exact match with a vigente droga is shown in red and
  disables the submit; an exact match with a baja droga suggests reactivating it.
- **Otros nombres**: optional rows (`sinonimo-0`, `sinonimo-1`, ...), each with
  the same live check (a short notice when the text is already a droga or a
  synonym, or equals the name being created). The command re-checks everything.

The PDF/QR receta import and the factura import keep creating synonyms through
"recordar esta equivalencia" (`modules/recetas/application/importar-receta.ts`,
`modules/stock/application/importar-factura-compra.ts`): `texto` is stored as
written; a text that is already a vigente droga's name is not remembered (it
already resolves by name); a vigente synonym pointing to another droga is a
`ConflictError`. Their lookups (`listAliasesVigentes`, `getDrogaAlias`) only see
vigente synonyms of vigente drogas — before 0067 a remembered text whose droga
was given de baja blocked that text forever.

Audit: entity `droga_alias` reads "sinónimo de droga"; rows carry `sinonimo`
and the readable `droga` name.

## Search

One rule everywhere, `shared/db/busqueda-droga.ts` (in `shared/` because the
pickers live in several modules and a module may not import another's
`infrastructure/`): a droga matches when the normalized query is a substring of
`fsj.normalizar_nombre(nombre)` **or** of one of its vigente synonyms. LIKE
wildcards in the query are escaped. When only a synonym matched, the matched
synonym's text comes back with the row.

| Picker / list | How |
|---|---|
| Receta componente (`DrogaPicker`) | `listDrogasParaReceta` (SQL fragment); name matches first. |
| `/catalogos/drogas` list and its autocomplete | `listDrogas` (`buscarDrogasPorTexto` → `id IN`). Rows show their synonyms on a muted line. |
| `/stock`, `/stock/ajustes`, ajuste nuevo, `/reportes/kardex` (`buscarDrogasStockAction`) | `listStockDrogasSql`; ajustes listing (`listAjustesSql`, also by lote); stock valorizado (`valorizado-repository.ts`). |
| `/stock/ingresar` + factura import combobox | `listDrogasOpciones` returns `sinonimos`; `filtrarOpciones` searches them client-side. |
| Comparador de costos, proveedor Trayectoria droga filter | Separate queries `proveedores.comparar-costos.sinonimos` / `proveedores.trayectoria.sinonimos` (each screen's own permiso) feed `filtrarOpciones`. |
| Libro contralor search | **Unchanged**: it searches its own snapshot text. |

### Visual hint

When an option matched through a synonym, the canonical name is shown and,
after it, a quiet hint: `Vaselina sólida ≈ petrolato` (`shared/ui/sinonimo-hint.tsx`:
`text-xs`, muted zinc, `title="Sinónimo"`, screen readers hear "también conocido
como petrolato"). No badge, no color. Nothing extra when the name itself matched.
Picking the option always picks the canonical droga.

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
| Ingreso de partidas (`/stock/ingresar`, manual and factura import) | **Display only** | Combobox value. Partidas stay keyed by `droga_id` alone (no schema change). A factura line matched through a remembered synonym shows the invoice text with the hint. |
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

## Scenarios

1. Droga "Vaselina sólida" with synonym "Petrolato". Typing `petro` in the
   receta picker shows `Vaselina sólida ≈ Petrolato`; picking it stores the
   droga, and the receta, ficha and libro read "Vaselina sólida".
2. Typing `cafeina` finds "Cafeína" (accent-insensitive), with no hint.
3. Creating a droga "petrolato" → field error on Nombre:
   `«Petrolato» ya es otro nombre de Vaselina sólida.`
4. Creating "Cafeina" when "Cafeína" is vigente → `«Cafeína» ya es el nombre de otra droga.`
5. Adding synonym "vaselina sólida" to "Petrolato" (if both existed) → field
   error on the synonym; the typed text stays in the box.
6. Removing "Petrolato" from "Vaselina sólida", then creating a droga
   "Petrolato" → allowed.
7. Giving "Vaselina sólida" de baja removes "Petrolato"; reactivating it does
   not bring it back; meanwhile "Petrolato" can be a new droga or another
   droga's synonym.
8. Factura import with "recordar esta equivalencia" for `PETROLATO USP` →
   synonym `PETROLATO USP` (as written); the next import of the same text
   resolves to that droga.
9. Typing `vasel` in the alta's Nombre lists "Vaselina sólida" (and any other
   droga containing it) before saving; typing `petrolato` shows
   `Ya existe: Vaselina sólida ≈ petrolato` and disables "Crear droga".
10. Creating "Vaselina sólida" with Otros nombres "Petrolato" and "Vaselina
    filante" → one droga, two synonyms, three audit rows. If "Petrolato" is
    already taken, the error marks that row, keeps everything typed and nothing
    is created.
11. Droga "Paracetamol" with synonym "Acetaminofén". In the receta form,
    typing `acetam` and picking it shows `Acetaminofén ≈ Paracetamol` in the
    componente's field; after saving, `/recetas/[id]`, its edit form and the
    preparaciones workspace show `Acetaminofén ≈ Paracetamol`; the ficha
    técnica, the libro recetario and the etiqueta read "Paracetamol".
12. Same receta; later "Acetaminofén" is removed from Paracetamol. The receta
    still shows `Acetaminofén ≈ Paracetamol`, and editing another ítem saves
    fine. Picking Paracetamol again in that componente (by its name) drops the
    synonym.
13. `/stock/ingresar`: typing `acetam` in a lote's droga and picking it shows
    `Acetaminofén ≈ Paracetamol`; the partida is stored for Paracetamol and
    `/stock` lists "Paracetamol".
14. PDF import with "ACETAMINOFEN 500 mg" and no match: the user picks
    Paracetamol by its name and ticks "Recordar esta equivalencia" → synonym
    `ACETAMINOFEN` is created and that componente is saved with it (shows
    `ACETAMINOFEN ≈ Paracetamol`). The next import of the same text arrives
    already matched and prefilled with that synonym.
