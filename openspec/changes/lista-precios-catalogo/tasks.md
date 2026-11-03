# Tasks

Design: `design.md`. Behavior: `specs/costos-proveedor/spec.md` (delta). No schema change (no migration, no
rollback SQL).

## 1. Parsing

- [x] 1.1 `domain/parsers/lista-catalogo.ts`: `parsearListaCatalogo` (header, shifted columns, data rows by code, base by `/000`, UM → unit, `Mi` ÷ 1000, `Tipo Iva` `E` → 0)
- [x] 1.2 `FilaListaLeida`: optional `unidadLista` and `alicuotaIva`
- [x] 1.3 `domain/parsers/parsear-lista.ts`: detect the layout and dispatch; message when neither header is found
- [x] 1.4 `application/leer-lista-precios.ts`: use `parsearLista`

## 2. Preview and evaluation

- [x] 2.1 `domain/importacion-lista.ts`: state `OMITIDA_UNIDAD` (label, precedence, not blocking, out of duplicates)
- [x] 2.2 `EntradaFilaLista` + `unidadListaId`, `alicuotaIva`; `unidadPrecioInicial` takes the list's unit
- [x] 2.3 `VigenteParaLista` + `alicuotaIva` (repository) and `planVersionar` with the alícuota the row will store
- [x] 2.4 `FilaVistaPreviaLista` + `um`, `porMillar`, `alicuotaIva`

## 3. Confirmation

- [x] 3.1 `importar-lista-precios.ts`: `alicuotaIva` per row through to `registrarFilasEnTx`
- [x] 3.2 `shared/audit`: `recordMany` (same rows as `record`, one `createMany`)
- [x] 3.3 `registrar-costos-proveedor.ts`: batch close / insert / audit (ids from the app, chunks of 500)

## 4. UI

- [x] 4.1 `ui/importar-lista-form.tsx`: UM and IVA columns, OMITIDA_UNIDAD chip, legend and message, header text, `alicuotaIva` in the payload

## 5. Tests

- [x] 5.1 Parser: shifted price column, footers / repeated headers / closing line, base vs presentation by code, `Mi`, `G`, unknown UM, `Tipo Iva` E/G, layout detection and the "neither header" message
- [x] 5.2 Preview: OMITIDA_UNIDAD (precedence, not blocking, no DUPLICADA), list unit as initial unit, exempt row over a 21 % vigente is not SIN_CAMBIOS
- [x] 5.3 Confirmation: `alicuotaIva` 0 stored; batch write keeps the result counts, ids order and one audit row per costo (existing `costos-proveedor-registrar` / `-importar-lista` tests still pass)

## 6. Verify

Found while verifying, fixed: the parser's canonical price ("129.339") was read as a typed number and refused as ambiguous, both in the server's first preview (`construirVistaPrevia`) and in the form's confirm payload. Both now pass it with comma decimals (`numeroParaInput`), as the form prefills it.


- [x] 6.1 `npm run typecheck`, `npm run lint`, `npm test`, `npm run specs:validate` (2026-11-03: no type errors outside the known `exceljs` / `next.config.ts` ones; lint 0 errors, same 285 warnings as before; 3807 tests pass; 35 specs valid)
- [x] 6.2 Against testeo (2026-11-03, the use cases run directly, confirmation rolled back): preview 684 asociadas, 120 omitidas (unidad), 22 duplicadas (11 drogas), 1 precio inválido (UM `%`), 2.470 presentaciones; confirm writes 684 costos + 684 audit rows in 4,7 s (before: over 60 s)
- [ ] 6.3 The preview page in the browser (`npm run dev`, logged in): UM / IVA columns, the OMITIDA_UNIDAD chip, confirm

## 7. Archive

- [ ] 7.1 Merge the delta into `openspec/specs/costos-proveedor/spec.md` (R6, R7a, R16, R16b, R16c, R18; the Status and decisions sections) and move the change to `changes/archive/`
