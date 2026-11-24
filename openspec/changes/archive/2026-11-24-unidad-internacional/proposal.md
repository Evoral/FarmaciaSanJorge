# Unidades internacionales (U.I.)

## Why

Some drugs are prescribed and supplied in international units (vitamina D3, vitamina A, vitamina E...): a receta says
"50.000 U.I." and the supplier's certificate says "1000 U.I. cada 10 g". Today the system cannot express either:

- `fsj.unidad_medida` has no U.I. — it was left out on purpose (migration 0006 seed, "DP-07 pending"), and
  `fsj.tipo_magnitud` only has `MASA`, `VOLUMEN`, `UNIDADES`.
- A partida's purity is only a percentage (`partida.potencia_declarada`, migration 0058): grams of active per 100 g
  of physical lot. "U.I. per gram" cannot be stored.

The pharmacist ends up converting by hand outside the system, and the ficha, the pesada and the libro recetario do not
show what was really prescribed.

## User decisions (2026-11-24)

1. **New magnitude `ACTIVIDAD`**, not `UNIDADES`: putting U.I. in `UNIDADES` (factor 1, like `UNIDAD` "u") would make
   the conversion layer treat 10 U.I. as 10 units without warning. INV-M01 (never convert across magnitudes) protects
   `ACTIVIDAD` for free.
2. **A marca on the droga** ("se dosifica en U.I."): only those drogas accept U.I. in a receta and U.I. partidas.
   The droga holds **no equivalence**: the equivalence lives only in the partida (its certificate).
3. **The receta is loaded as prescribed**: in U.I. (TOTAL, POR_DOSIS or CONCENTRACION, e.g. "10.000 U.I./g") or in
   mass (mg, g).
4. **A partida is loaded one of two ways**, even for a droga marked U.I.: in grams (purity % optional, as today) or in
   U.I. ("X U.I. cada Y g", mandatory when the partida is U.I.). A lot loaded with the wrong kind is dado de baja and
   loaded again; a mistyped U.I./g is corrected with "Corregir pureza" (same rules: motivo, audited, no active
   reserva, future preparations only).
5. **When the receta's unit and the lot's cannot be converted** (receta in U.I. and only gram lots, or receta in mg
   and only U.I. lots), the línea becomes a **cantidad manual**: the DT types the physical grams, the línea is
   highlighted for review and recorded as manual.
6. **A U.I. lot without enough balance** is a faltante, as today: no line is half computed, half manual. The DT may
   switch the whole línea to cantidad manual.
7. **The excipiente (CSP / c.s.p.) is not recalculated**: with an active in U.I. the ficha already leaves the CSP as
   enrase manual (ficha-tecnica R4/R5) and the excipiente is used as typed (`pesoDeDrogas` returns `null`). The
   preparación shows a highlighted notice that the U.I. droga's weight is not subtracted.
8. **Etiqueta and libro recetario print what was prescribed** (U.I.). Both already read the receta's componentes; no
   code change, scenarios only.

## What Changes

- Schema: `ACTIVIDAD` in `fsj.tipo_magnitud` (own migration), the `UNIDAD_INTERNACIONAL` unit (`U.I.`), the droga
  marca, `partida.actividad_declarada` (U.I. per gram, exclusive with `potencia_declarada`), the snapshot
  `movimiento_stock.actividad_aplicada`, the manual-equivalence flag on `reserva_stock` / `movimiento_stock`, and
  INV-S12 extended to U.I. lines.
- Recetas: U.I. in componentes of a marked droga (TOTAL, POR_DOSIS, CONCENTRACION).
- Stock: every path that creates a partida accepts "X U.I. cada Y g"; "Corregir pureza" corrects U.I./g.
- Preparaciones: the split, the pesada and the confirmation weigh a U.I. line in grams through the lot's U.I./g; the
  cantidad manual fallback.
- Precios: the cotización estimates a U.I. line through the first U.I. lot (FEFO); without one, "sin precio".

## Capabilities

### New Capabilities

- `unidad-internacional`: U.I. in recetas, partidas, pesada and cotización.

### Modified Capabilities

- `ficha-tecnica`: R9 (the new magnitude) and INV-S12 (consumption of a U.I. line and of a cantidad manual línea).

## Impact

- Schema change: migrations 0132 and 0133 + `prisma/rollbacks/*.down.sql` + `docs/rollbacks/unidad-internacional.md`.
  The user applies migrations by hand (dev and prod).
- Modules: `unidades` (catalog), `drogas`, `recetas`, `elaboracion` (ficha), `stock`, `preparaciones`, `precios`.
- Past data: untouched. Existing partidas stay as they are (gram lots); no ficha, movement or asiento is recalculated.

## Out of scope

- An equivalence U.I. ↔ mass on the droga (decision 2).
- Recalculating the excipiente from the lot's physical grams (decision 7).
- Switching a partida between grams and U.I. after intake (decision 4: baja and new alta).
- Partidas of kind FORMULA (another droga) in U.I.; only DILUCION of a U.I. lot carries U.I./g.
- **Pending, separate change:** the excipiente subtracts the drogas' **active** weight (`pesoDeDrogas` uses
  `cantidadAPesar`), not the **physical** weight weighed from lots with purity < 100 %. With a 0,1 % lot, 0,15 mg of
  active weighs 0,150 g of powder but only 0,00015 g is subtracted. Not caused or changed by this proposal.
