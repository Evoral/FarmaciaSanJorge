# Proposal — Insumos de la preparación (material e insumos adicionales)

> **Status:** approved and implemented (User decision 2026-10-29). Pending verification, then archive.

## Why

The excipiente is the only insumo the lab can record today (`openspec/specs/excipiente-preparacion/spec.md`). The
cápsulas, frascos and any extra excipiente are used but never descontado, so their stock is not real.

## What

Keep the single excipiente exactly as it is. Below it, with exactly the same mechanics (ficha row in the toma, second
chance in "Marcar como preparada", saved as filled in, quantity required once chosen, reserved oldest lot first
automatic, re-planned by "Recalcular reserva" / "Registrar pérdida", descontado at "Imprimir etiquetas" as
EGRESO_PREPARACION without línea, read-only once reserved, released by "Liberar reserva"):

1. A **Material** row: buscador of the vigente drogas of clase MATERIAL (with sinónimos), quantity in the material's
   unidad base, its symbol from the droga.
2. **Cápsulas rule:** when the ítem's forma is CAPSULA, the Material's quantity is pre-filled with the number of
   cápsulas and no material is chosen; the user picks the cápsula type to confirm. No material chosen = nothing
   reserved, nothing blocks. Once chosen, the quantity is required (editable).
3. **Agregar insumo:** any number of extra rows, buscador of clase EXCIPIENTE and MATERIAL, each with its own
   quantity; removable while not reserved.

A droga can not repeat across excipiente + material + adicionales (server-side, clear message).

## User decisions (2026-10-29)

- The behavior above, shown both in the ficha and in the dialog's second-chance area (the dialog lists already-added
  insumos read-only, as E9 does for the excipiente).
- Libro: materials never appear; adicionales of clase EXCIPIENTE appear in the fórmula next to the excipiente; no
  contralor for any of them.

## Scope

- Migration 0110 (`fsj.insumo_preparacion`, `fsj.insumo_borrador`, 0092's triggers relaxed), rollback files.
- `modules/preparaciones` domain/application/infrastructure/ui and the toma page.
- New spec `openspec/specs/insumos-preparacion/spec.md`; E7 of `excipiente-preparacion` modified.

## Out of scope

- Choosing the lot of an insumo (always automatic, like the excipiente).
- Insumos in the ficha técnica itself (fichas stay immutable) or in the presupuesto / precio.
- Unit selectors (always the droga's unidad base).
