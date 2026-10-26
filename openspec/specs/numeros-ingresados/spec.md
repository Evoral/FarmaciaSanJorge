# Números ingresados

Status: implemented 2026-10-19 (no schema change). Code: `shared/decimal/numero-ingresado.ts`.

## Goal

The lab writes es-AR numbers: comma for decimals, dot for thousands. The forms read them with `new Decimal()`, so
"1,5" was refused and **"1.500" was accepted as 1,5 -- a silent 1000x error** in a weight, a stock quantity or a
price. Every typed number is now read by ONE rule, and an ambiguous one is never guessed.

## Rules

| # | Typed | Read as | Why |
|---|---|---|---|
| N1 | `1,5` / `,5` | 1,5 / 0,5 | Comma = decimal separator. |
| N2 | `1.234,5` | 1234,5 | es-AR thousands + decimals (dots only in groups of three). |
| N3 | `0.015`, `12.5`, `1.25`, `0.500` | decimal point | A dot that can not be thousands (not three digits after it, or a leading 0): what the forms accepted until now. |
| N4 | `1.500`, `12.000`, `1.234.567` | **refused** | Could be thousands or decimals: the message offers both ("escribí 1500 (sin punto) o 1,5 (con coma)"). DT/owner decision 2026-10-19. |
| N5 | `1 500` | 1500 | Spaces ignored. |
| N6 | `1e3`, `abc`, `1,2,3` | refused | "Usá coma para los decimales (1,5) y no separes los miles (1500)." |
| N7 | — | — | **Prefills use a comma** (`numeroParaInput`): an edit form saved untouched never trips N4 (a stored 1.234 shows as "1,234"). |

## Where

- Server edge: `shared/validation` `decimalString` / `positiveDecimalString` (pesada, pérdidas, reglas de precio,
  unidades, costos), `modules/stock/domain/partida.ts` (ingreso, ajuste, factura, costo, pureza),
  `modules/drogas/domain/droga.ts` (stock mínimo), `modules/recetas/application/crear-receta.ts` (cantidades of the
  receta, its presupuesto and the fichas preview), `modules/parametros/domain/parametros-registry.ts`,
  `modules/etiqueta-tamanos/application/medida-mm.ts`, `modules/costos-proveedor/domain/importacion-lista.ts`.
- Live previews (same reading in the browser): receta presupuesto readiness (`modules/recetas/domain/presupuesto.ts`),
  pesada tolerance (`modules/preparaciones/ui/confirmar-form.tsx` `cantidadValida`), factura totals.
- Prefills (N7): receta edit, pesada/confirmation, factura and lista de precios imports, reglas de precio, unidad,
  droga, parámetros (etiqueta medidas already did).

Not affected: numbers read from files (PDF/Excel parsers keep their own format detection) and integer-only fields.
