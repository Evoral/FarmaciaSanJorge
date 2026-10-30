# Design — insumos-preparacion

Follows the excipiente (migration 0092, `modules/preparaciones/application/excipiente-preparacion.ts`) step by step.

## Data model (migration 0110)

| Object | Purpose |
|---|---|
| `fsj.tipo_insumo` enum (`MATERIAL`, `ADICIONAL`) | Kind of an insumo row |
| `fsj.insumo_preparacion` (tenant, preparacion, tipo, orden, droga, cantidad, texto) | What the preparación used. INSERT only (default privileges), BEFORE INSERT trigger: preparación INICIADA (INV-P08), clase admitted per tipo, never the preparación's excipiente. `UNIQUE (tenant, preparacion, droga)` + partial unique "one MATERIAL" |
| `fsj.insumo_borrador` (tenant, ficha, tipo, orden, droga?, cantidad?) | Draft per ficha, replaced as a whole on each save (DELETE granted, no UPDATE) |
| `fsj.validar_reserva_excipiente` / `validar_egreso_excipiente` | Relaxed: a línea-less row is valid for the excipiente's droga OR an `insumo_preparacion` droga of the same preparación |

`texto` ("Aerosil 0,5 g") is a snapshot like `preparacion.excipiente_texto`, so the libro's fórmula does not depend on
later renames. The `reserva_stock` unique key `(tenant, preparacion, linea, partida)` is a plain UNIQUE (NULLs
distinct): unaffected; distinct drogas keep the línea-less rows unambiguous.

## Telling línea-less rows apart

Before 0110 every línea-less reserva was the excipiente's. Now the excipiente's and each insumo's rows are selected by
the partida's droga: `listReservasSinLinea(…, drogaId?)` (raw join with `fsj.partida`), `deleteReservasSinLinea(…,
drogaId)`, `insertReservasSinLinea`. The excipiente functions were switched to them (the old unscoped versions would
have consumed an insumo's partidas as excipiente).

## Use cases

- `guardarInsumosBorrador` (`defineCommand`, `preparaciones.confirmar`, MODIFICAR on `ficha_tecnica`): whole list;
  keeps the Material with a quantity and no droga (the cápsulas' count); `validarInsumosEnTx` against the excipiente's
  draft. `guardarExcipienteBorrador` refuses a droga already in the insumos draft.
- `reservarStock` input gains `insumos[]` (only rows with a droga); candidates locked in the same statement as the
  líneas' and the excipiente's; `reservarInsumosEnTx` after `reservarExcipienteEnTx` (the trigger checks the excipiente).
- `recalcularReservaStock`, `registrarPerdidaReserva`: `replanificarInsumosEnTx` before deleting,
  `guardarReservaInsumosEnTx` after.
- `confirmarPreparacionEnTx`: `consumirInsumosEnTx` after the excipiente. `confirmarReservasReceta` also locks the
  línea-less partidas in its single id-ordered lock (it only locked the líneas' before).
- `planificarSinLinea` (exported from excipiente-preparacion.ts) is the shared split: abiertas then FEFO, physical.

## Libro

`getItemPrescriptoDePreparacion` adds `adicionales` = texts of ADICIONAL insumos of clase EXCIPIENTE;
`formatearFormulaPrescripcion` appends them after the excipiente's "c.s.p." line, without "c.s.p." (they carry their
own quantity). Materials never. No detalle line, no contralor (only clase DROGA is controlled).

## UI (`ui/pesaje-en-toma.tsx`)

`PesajeProvider` holds `filas` (the Material always first, then the adicionales, each with a client key) and saves the
list through one hidden form (`BorradorInsumos`, `guardarInsumosBorradorAction`, under `conOperador`), like the
excipiente. Rows: `FilasInsumos` / `BuscadorInsumo` (options exclude drogas used by other rows or the excipiente) /
`CantidadInsumo` / `AgregarInsumo`. Dialog: rows with a droga at opening are read-only (`InsumoFijo`), the rest
editable (`InsumoEnDialogo`), plus "Agregar insumo"; the reserva form sends parallel `insumoTipo` / `insumoDrogaId` /
`insumoCantidad` fields. The toma page shows "Material utilizado" / "Insumos adicionales" once reserved.
