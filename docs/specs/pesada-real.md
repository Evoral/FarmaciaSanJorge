# Pesada real

Status: implemented 2026-10-19 (migration 0088). Rollback: `docs/rollbacks/pesada-real.md`.
**2026-10-19, pesada en la ficha** (migrations 0090, 0091): the lots and the real weighing moved from the "Marcar como
preparada" dialog into the ficha técnica itself, saved línea by línea (P8-P12). Rollback: `docs/rollbacks/pesada-borrador.md`.

## Goal

The lab weighs by hand. What the balance shows never matches the computed
`cantidadAPesar` exactly, and stock, contralor and libro drifted from the real
bottle because they always used the theoretical weight. Now the "Marcar como
preparada" form (and "Recalcular reserva", `/preparaciones/[id]`'s
confirmation) records the **real weighing** of every non-manual línea, and that
is what is consumed.

## Rules

| # | Rule | Enforced in |
|---|---|---|
| P1 | **Lot choice for every línea.** The form lists the droga's eligible partidas (abiertas first, then FEFO) as checkboxes, pre-checked with the automatic plan's (the oldest first; an enrase manual línea: the first one to consume; a recalculation: the current reserva's). The split runs over the checked ones, in that order. When the partidas differ in purity the block warns that the weight depends on the lot (R25 of `reserva-stock-preparacion.md`). | `ElegirLotes`, `lotesPorDefecto` (`ui/confirmar-form.tsx`); `planificarConsumoEnTx` (`partidaIds`). |
| P2 | **Pesada real field** (non-manual líneas, línea unit). Prefilled with the expected PHYSICAL weight of the checked lots (purity-corrected) rounded **half-up** to `precision_balanza` (GRAMO; only MASA líneas -- a volumen/unidades línea is not rounded): 0,0455 g → 0,046 g, 0,0454 g → 0,045 g. It follows the lots until the user types. | `pesadaDeLinea`, `PesadaReal` (`ui/confirmar-form.tsx`); `precisionDeLinea`, `redondearABalanza` (`domain/pesada-real.ts`). |
| P3 | **Tolerance.** margen = max(esperada × `tolerancia_pesada_porcentaje` / 100, one balance division). \|real − esperada\| ≤ margen is accepted. Outside it the form shows the deviation and the **DT co-firma** (same block and verification as ajustes/pérdidas: the DT types their own password, failed attempts audited); without it the server refuses with the deviation and the field marked. Parameter default **5 %** (USP <795> allows 90–110 % of the declared active for the finished preparation; half of that margin is kept for the rest of the process). Editable in Parámetros. | `evaluarPesada` (`domain/pesada-real.ts`); `planificarConsumoEnTx`; `autorizacionDePesadaReal` (`application/co-firma-pesada-real.ts`); DB `pesada_real_tolerancia_check`. |
| P4 | **What is consumed.** The real (physical) weight, drained over the checked lots in order (`repartirPesadaReal`), each part keeping its partida's potencia. Stock (`movimiento_stock`), contralor (`asiento_contralor`) and the libro's detalle use it. | `planificarConsumoEnTx`, `confirmarPreparacionEnTx`. |
| P5 | **Reserva.** `reserva_stock.cantidad_real` and `pesada_autorizada_por_id` keep the real weighing and the co-firma until "Imprimir etiquetas". A recalculation or a pérdida's re-plan keeps the stored co-firma only while the pesada real is the same; a new one outside the tolerance needs a new co-firma. | `reservasDelPlan`, `lineasDesdeReservas`, `entradasDeReserva`, `autorizacionesDeReserva`. |
| P6 | **Record.** The confirmation writes one immutable `fsj.pesada_real` row per línea weighed for real: esperada, real, margen, the DT (outside the margen; a DT vigente, INV-U05) and who registered it. INV-S12 then checks the línea's physical consumption equals `cantidad_real`; a línea without a row keeps the 0073 rule (active consumption = `cantidad_a_pesar`). The audit of reservar / recalcular lists the pesadas (`pesadasReales`). | Migration 0088 (`fsj.linea_pesaje_validar_consumo`, `trg_pesada_real_validar_autorizacion`); `pesadasDelPlan`. |
| P7 | Enrase manual líneas are unchanged: their typed quantity already is the real one; no tolerance. | — |

## Pesada en la ficha (2026-10-19, migration 0090)

The pharmacist weighs and assembles step by step; leaving everything for the end risks forgetting a weighing. So the
toma workspace's ficha técnica (Pendiente ítem with a vigente ficha, user with `preparaciones.confirmar`) is filled in
while weighing, and the dialog only confirms.

| # | Rule | Enforced in |
|---|---|---|
| P8 | **Lot selector per línea**, in consumption order (abiertas, then FEFO), preselected with the automatic plan's lots (the oldest; two when the oldest does not cover). Each option: lote and stock disponible (whole numbers, largest unit); plus the purity when the droga's lots declare one, "abierta" and the date of a lot por vencer. "Agregar otro lote" adds another when the chosen ones do not cover the línea (or to split on purpose); the chosen lots are drained in consumption order whatever the order they were picked in (P1/P4). A lot whose purity changes the weight shows what to weigh from it in the "A pesar" column. | `PesajeTabla`, `FilasLinea` (`ui/pesaje-en-toma.tsx`) |
| P9 | **"Cantidad real pesada" column**, right of "A pesar": the P2 field (prefilled, follows the lots until typed; deviation and tolerance under it), or the enrase manual quantity (P7). The INV-S18 motivo shows under the línea only when asked. | `CantidadReal` (`ui/pesaje-en-toma.tsx`) |
| P10 | **Saved as it is filled in**: a lot change at once, a quantity or motivo when its field is left (or Enter), one draft row per línea (`fsj.pesada_borrador`: lots in order, quantities in the línea's unit). Survives a reload, another PC or another pharmacist; a regenerated ficha has new líneas and starts clean. A draft writes no stock, libro or contralor; it is refused once the ítem has a live preparación. Audited (MODIFICAR on the línea). Permiso `preparaciones.confirmar`, no re-authentication (like the excipiente); operator PIN on a cuenta de sector. | `guardarBorradorPesada` (`application/guardar-borrador-pesada.ts`); migration 0090 |
| P11 | **"Marcar como preparada" only confirms**: a dialog lists each línea's lot(s) and real weighing, blocks while a línea lacks stock in its lots, a lot or an enrase quantity, adds the DT co-firma when a pesada is outside the tolerance (P3), and sends the same fields as before to `reservarStock` -- which re-validates everything under its locks (P1-P6 unchanged). "Recalcular reserva" and `/preparaciones/[id]` keep the full form. | `MarcarPreparadaDialog` (`ui/pesaje-en-toma.tsx`); `ui/confirmar-form.tsx` |
| P12 | **"Exceso %" column hidden** in the ficha while no línea applied an exceso (`exceso_pesada_porcentaje` = 0 when it was generated); it appears by itself once Parámetros sets it above 0. | `conExceso` (`ui/lineas-ficha-tabla.tsx`) |

## Decisions

- Tolerance default 5 %: no official per-weighing figure was found; the
  accepted reference is USP <795>'s 90–110 % for the finished preparation. The
  DT should confirm whether the Farmacopea Argentina sets another value.
- The margen is never smaller than one balance division: a 9 mg línea on a
  1 mg balance accepts ±1 mg (±11 %), the most the balance can tell.
- Triturados/diluciones are done in the moment (excipiente first, droga added
  up to a readable number): no separate stock; the droga consumed is the real
  weighing. Weighing on top of excipiente does not improve the resolution of
  the drug's own weight.

## Open

- The DT co-firma's vigency is checked by the DB on the confirmation's server
  date (same simplification as INV-U05 for ajustes).
