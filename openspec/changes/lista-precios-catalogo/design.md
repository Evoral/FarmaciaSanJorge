# Design — Importar la lista "Listado de precios: Catálogo"

Proposal: `proposal.md`. Behavior: `specs/costos-proveedor/spec.md` (delta).

No schema change. Everything stays in `modules/costos-proveedor`, plus one helper in `shared/audit`.

## Parsing (domain, pure)

- **`domain/parsers/lista-catalogo.ts`** (new): `parsearListaCatalogo(filas: FilaCruda[]): ResultadoParseoLista`.
  - Header: the first row whose normalized cells (case, accents, spaces, as `normalizarCelda` in
    `lista-xlsx-crystal.ts`) include `codigo producto`, `descripcion`, `um`, `precio` and `tipo iva`.
  - Each field is read with `celdaCercana(fila, columna, tipo)`: the header's column, else column −1, else +1, only
    if the cell holds the right type (code/description/UM/IVA: text; price: number or text parsed as today by
    `precioDe`). Verified on the real file: `Precio` header in R (17), values in Q (16); `Tipo Iva` header in
    T (19), values in U (20); the others are aligned.
  - Data row = code matches `^\d+/\d+$`; everything else is skipped (`descartadas` counts the non-blank ones, as
    the other parser does). Row numbers are the sheet's own (1-based). `MAX_FILAS_LISTA` applies the same way.
  - `presentacion`: `null` for a `/000` code; otherwise the text after the base description if it has one
    (`detectarPresentacion`), else the code itself, so the existing "Presentación: …" line in the preview has
    something to say.
  - Prices: same canonical decimal as today (`precioDe`, 15 significant digits). `Mi` → price / 1000 with
    `decimal.js`, exact.
- **`FilaListaLeida`** gains two optional fields (absent = Lista de medicamentos, the current behavior):
  - `unidadLista: { um: string; codigo: "KILOGRAMO" | "GRAMO" | "LITRO" | "UNIDAD" | null; porMillar: boolean } | null`
    — the UM as written and the catalog unit it maps to (R16c; `null` codigo = UM without equivalent);
  - `alicuotaIva: string | null` — `"0"` for `Tipo Iva` `E`, `null` otherwise (R7a inheritance applies).
- **`domain/parsers/parsear-lista.ts`** (new): `parsearLista(filas)` looks for either header and dispatches to
  `parsearListaCrystal` or `parsearListaCatalogo`; neither → `ValidationError` with a message that names both
  layouts. `leer-lista-precios.ts` calls it instead of `parsearListaCrystal`. The Lista de medicamentos parser is
  untouched (its tests stay as they are).

## Preview and row evaluation (`domain/importacion-lista.ts`, shared by server and browser)

- `ESTADOS_FILA_LISTA` + `OMITIDA_UNIDAD` ("Omitida (unidad)"), not in `ESTADOS_QUE_BLOQUEAN`.
- `EntradaFilaLista` + `unidadListaId: string | null` (the catalog unit the list stated, resolved by codigo among
  vigente units) and `alicuotaIva: string | null`.
- `evaluarFilasLista` precedence: OMITIDA_PRESENTACION → OMITIDA → SIN_ASOCIAR → **OMITIDA_UNIDAD** (the row's
  `unidadPrecioId` is still the list's own and its magnitud differs from the droga's unidad base) → DUPLICADA → …
  An OMITIDA_UNIDAD row is not "en juego", so it never makes another row DUPLICADA. When the user picks another
  unit the row is evaluated as any other (a unit of another magnitud picked by hand stays PRECIO_INVALIDO, R5).
- `unidadPrecioInicial`: the list's unit when the row has one with a codigo; else the R6 default by magnitud.
- SIN_CAMBIOS / variation must see the alícuota: `VigenteParaLista` + `alicuotaIva`
  (`getCostosVigentesDeProveedor` already reads the row); `planVersionar` gets
  `nuevo.alicuotaIva = entrada.alicuotaIva ?? vigente.alicuotaIva` (what the command will store, R7a), so an
  exempt row over a 21 % vigente is a new version, not "sin cambios".
- `FilaVistaPreviaLista` + `um`, `porMillar`, `alicuotaIva` for display.

## Confirmation (`application/importar-lista-precios.ts` → `registrar-costos-proveedor.ts`)

- `filaImportacionWire` + `alicuotaIva: z.unknown().optional()`, passed to `registrarFilasEnTx`, which already
  validates it (`alicuotaIvaSchema.nullish()`) and applies "row → vigente → parametro". Nothing else changes in the
  rules.
- **Batch writes.** Today every costo is written with 2–3 round trips (close, insert, audit). With ~700 rows that
  is ~1.400–2.100 statements in one transaction: measured from a dev machine against the shared Supabase project
  (~40 ms per round trip) the confirmation exceeded the 60 s budget of `withTenantTransaction`. In production
  (Vercel `gru1` and Supabase `sa-east-1`, both São Paulo) it would likely fit, but the same import must also work
  from `npm run dev` against testeo. So step 7 of `registrarFilasEnTx` becomes:
  - one `updateMany({ where: { id: { in: cerrar } } , data: { vigenteHasta: ahora } })` for the REEMPLAZAR rows;
  - one `createMany` for the new costos, with ids generated in the app (`randomUUID`), so no `RETURNING` is needed
    and `resultado.ids` keeps its order;
  - one `audit.recordMany(tx, inputs)` (new in `shared/audit`): the same row `record` writes (request context and
    operador computed ONCE, then `createMany`). `record` stays as is for every other caller.
  The manual entry (one row) goes through the same code; the behavior, the audit rows and their content do not
  change. Chunk `createMany` at 500 rows to keep each statement's parameter count bounded.

## UI (`ui/importar-lista-form.tsx`)

- Columns: **UM** (the list's, with "por millar ÷ 1000" when `porMillar`) and **IVA** ("Exento" / the alícuota it
  will take) when the layout carries them; hidden for the Lista de medicamentos.
- Chip and legend for OMITIDA_UNIDAD, with the row message "La lista da el precio por {UM} y {droga} se mide en
  {unidad base} ({magnitud}): sin densidad no se puede convertir."
- Header text: "Los precios son sin IVA, por la unidad de cada fila" for the Catálogo (the current "por kg / L / u"
  stays for the Lista de medicamentos).
- The confirm payload adds `alicuotaIva` per row. Forms keep input on error (`use-form-submit`), unchanged.

## Not changed

- Matching (R17), synonyms and "recordar equivalencia" (R19), R9/R10/R21/R22/R23, the readers (R14), limits (R15).
- Duplicates `0xxxx` / `9xxxx` stay DUPLICADA (CP7): the user omits one.
