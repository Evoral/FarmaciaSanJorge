# Números ingresados

## Purpose

The lab writes es-AR numbers: comma for decimals, dot for thousands. The forms read them with `new Decimal()`, so
"1,5" was refused and **"1.500" was accepted as 1,5 -- a silent 1000x error** in a weight, a stock quantity or a
price. Every typed number is now read by ONE rule, and an ambiguous one is never guessed.

## Requirements

### Requirement: N1 — Comma is the decimal separator

A typed `1,5` or `,5` SHALL be read as 1,5 / 0,5: the comma is the decimal separator.

#### Scenario: Comma decimals

- **WHEN** the user types `1,5`
- **THEN** it is read as 1,5
- **AND** `,5` is read as 0,5

### Requirement: N2 — es-AR thousands with decimals

A typed `1.234,5` SHALL be read as 1234,5: es-AR thousands plus decimals (dots only in groups of three).

#### Scenario: Thousands and decimals

- **WHEN** the user types `1.234,5`
- **THEN** it is read as 1234,5

### Requirement: N3 — A dot that can not be thousands is a decimal point

A dot that can not be thousands (not three digits after it, or a leading 0) SHALL be read as a decimal point, as
the forms accepted until now: `0.015`, `12.5`, `1.25`, `0.500`.

#### Scenario: Not three digits after the dot

- **WHEN** the user types `12.5` or `1.25`
- **THEN** the dot is read as a decimal point (12,5 / 1,25)

#### Scenario: Leading zero

- **WHEN** the user types `0.015` or `0.500`
- **THEN** the dot is read as a decimal point (0,015 / 0,5)

### Requirement: N4 — An ambiguous dot is refused

A number such as `1.500`, `12.000` or `1.234.567` could be thousands or decimals, so it MUST be refused, and the
message offers both readings ("escribí 1500 (sin punto) o 1,5 (con coma)"). DT/owner decision 2026-10-19.

#### Scenario: Ambiguous thousands

- **WHEN** the user types `1.500`
- **THEN** the number is refused
- **AND** the message offers both readings: "escribí 1500 (sin punto) o 1,5 (con coma)"

### Requirement: N5 — Spaces are ignored

A typed `1 500` SHALL be read as 1500: spaces are ignored.

#### Scenario: Space as separator

- **WHEN** the user types `1 500`
- **THEN** it is read as 1500

### Requirement: N6 — Anything else is refused

Input such as `1e3`, `abc` or `1,2,3` MUST be refused with "Usá coma para los decimales (1,5) y no separes los
miles (1500)."

#### Scenario: Malformed number

- **WHEN** the user types `1e3`, `abc` or `1,2,3`
- **THEN** it is refused with "Usá coma para los decimales (1,5) y no separes los miles (1500)."

### Requirement: N7 — Prefills use a comma

Prefills SHALL use a comma (`numeroParaInput`), so an edit form saved untouched never trips N4 (a stored 1.234
shows as "1,234").

#### Scenario: Edit form saved untouched

- **GIVEN** a stored value of 1.234
- **WHEN** an edit form shows it
- **THEN** the field reads "1,234"
- **AND** saving the form untouched is not refused by N4

## Status

Implemented 2026-10-19 (no schema change). Code: `shared/decimal/numero-ingresado.ts`.

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
