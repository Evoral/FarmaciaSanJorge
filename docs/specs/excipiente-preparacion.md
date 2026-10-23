# Excipiente de la preparación

Status: implemented 2026-10-19 (migration 0092). Rollback: `docs/rollbacks/excipiente-preparacion.md`.
Replaces the free-text "Excipiente utilizado" of a reserved ítem (migration 0083).

## Goal

The lab records the excipiente it used while it weighs, like the pesada real, and its stock must be real: the
excipiente is chosen from the catalog (no free text), with its quantity, and is descontado like the drogas.

## Rules

| # | Rule | Enforced in |
|---|---|---|
| E1 | **In the ficha, before "Marcar como preparada"**: a row "Excipiente" under the líneas (Pendiente ítem with the pesada en la ficha, `docs/specs/pesada-real.md` P8-P12). A buscador of the vigente drogas of **clase EXCIPIENTE** (type to filter; only a listed one can be chosen, like every buscador of the app) and its quantity in the droga's **unidad base**, in the "Cantidad real pesada" column. Optional. | `FilaExcipiente` (`ui/pesaje-en-toma.tsx`) |
| E2 | **Saved as it is filled in**: the choice at once, the quantity when left (or Enter); one draft per ficha técnica (`fsj.excipiente_borrador`). Refused once the ítem has a live preparación. Audited (MODIFICAR on the ficha). | `guardarExcipienteBorrador`; migration 0092 |
| E3 | **Quantity required once chosen**: "Marcar como preparada" is blocked ("Falta la cantidad del excipiente") and the server refuses it. | `MarcarPreparadaDialog`; `reservarStock` input |
| E4 | **Reserved with the drogas**, oldest lot first, automatic (abiertas, then FEFO; physical, no purity correction -- `repartirLinea` as an enrase), over the stock not reserved by others. A shortfall refuses the reserva with what is missing. The preparación keeps the droga, the quantity and the fórmula's text ("Ludipress 12,5 g", `excipiente_texto`). | `reservarExcipienteEnTx` (`application/excipiente-preparacion.ts`) |
| E5 | **Re-planned** by "Recalcular reserva" and "Registrar pérdida" (a pérdida may be registered on the excipiente's lot); computed before anything is deleted, so a shortfall leaves the reserva as it was. | `replanificarExcipienteEnTx`, `guardarReservaExcipienteEnTx` |
| E6 | **Descontado at "Imprimir etiquetas"**: EGRESO_PREPARACION over its reserved lots, in the same transaction as the líneas. Never contralor (an EXCIPIENTE can not be controlled, 0063). In the libro it is in the **fórmula** ("excipiente utilizado"), not a detalle line (insumos are left out of the detalle, as before). | `consumirExcipienteEnTx`; `confirmarPreparacionEnTx` |
| E7 | **No línea de pesaje**: fichas are immutable and the prescription is not altered, so its reserva and egreso have `linea_pesaje_id` NULL -- allowed by the DB ONLY for the preparación's excipiente (the partida's droga = `preparacion.excipiente_droga_id`, a droga of clase EXCIPIENTE). | Migration 0092 triggers |
| E8 | **Read-only once reserved** ("Excipiente utilizado: …"); to change it, "Liberar reserva" and mark it again. "Liberar reserva" releases its stock with the rest. | Toma page |
| E9 | **Second chance in "Marcar como preparada"** (user decision, 2026-10-22). When the dialog opens with no excipiente added in the ficha, it shows the same buscador (clase EXCIPIENTE only) and quantity field; what is chosen there is the same draft as the ficha's row (saved the same way). With an excipiente already added the dialog lists it read-only, as before. | `MarcarPreparadaDialog`, `BuscadorExcipiente` / `CantidadExcipiente` (`ui/pesaje-en-toma.tsx`) |

## Decisions

- Lot: always automatic, oldest first (owner decision 2026-10-19: it is an excipiente, no lot choice needed).
- Unit: the droga's unidad base (no unit selector).
- Reservations made before 0092 keep their free-text excipiente; they show it read-only.
