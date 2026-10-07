# Sinónimos de droga

Status: implemented 2026-10-07 (migration 0067). Rollback: `docs/rollbacks/sinonimos-droga.md`.

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
| R3 | No two **vigente** synonyms share a normalized form (one synonym → one droga). | DB: partial unique index `uq_droga_alias_vigente` (replaces 0049's plain UNIQUE). App: `agregarSinonimo` and the imports' "recordar esta equivalencia". |
| R4 | A vigente synonym never equals a vigente droga's normalized name, and vice versa (a droga insert, rename or reactivation cannot take a vigente synonym). | DB: `INV-DRG-002` triggers `trg_droga_alias_validar` / `trg_droga_nombre_no_es_sinonimo`, serialized by a transaction advisory lock on (tenant, normalized name). App: same checks with readable messages. |
| R5 | A synonym is removed with a soft delete (`fecha_baja`) and stays removed: adding the text again creates a new row (for this or another droga). | DB: `INV-DRG-003`; fsj_app may UPDATE `fecha_baja` only, no DELETE. App: `quitarSinonimo`. |
| R6 | Giving a droga de baja removes its vigente synonyms, in the same transaction. **Reactivating it does not restore them.** | DB: `trg_droga_baja_quita_sinonimos` (AFTER UPDATE OF fecha_baja). Migration 0067 also applies it to drogas already de baja. |
| R7 | A droga dada de baja takes no new synonyms. | App: `agregarSinonimo` (locks the droga first). |
| R8 | Reactivating a droga whose name is now taken (by another droga or a synonym) is refused with a readable message. | App: `reactivarDroga`; DB: R2 index / R4 trigger. |
| R9 | Recetas, libro recetario, libros contralor, fichas, etiquetas and PDFs keep snapshotting the **canonical** `droga.nombre`. Synonyms are a search aid only. | Unchanged code paths. |

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

- `drogas.sinonimos.agregar` (`agregarSinonimo`, permiso `drogas.editar`, audit `droga_alias` CREAR): `{ drogaId, sinonimo }`.
- `drogas.sinonimos.quitar` (`quitarSinonimo`, permiso `drogas.editar`, audit `droga_alias` BAJA): `{ id }`.
- `drogas.ver` now returns the droga's vigente `sinonimos`.
- `crearDroga` / `editarDroga` / `reactivarDroga`: R2 + R4 checked against drogas **and** synonyms.

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
