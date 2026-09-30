/**
 * The per-receta "Preparar" / "Continuar preparación" action of the
 * /recetas list. Pure, no I/O: the list query hands in, per item, its
 * latest ficha and its preparaciones; this decides what to offer.
 *
 * It acts on the FIRST item (detail-page order) that still needs work --
 * no CONFIRMADA preparación. (An item whose asiento was later dejado "sin
 * efecto" also has a CONFIRMADA preparación, so it is done here too.)
 *
 *   - that item has a preparación INICIADA -> "Continuar" (a link to it);
 *   - else, it has a ficha -> "Preparar" (the existing
 *     `preparaciones.iniciar` on its LATEST ficha);
 *   - else -> a link to generate the ficha from the receta.
 *
 * Nothing when the receta is terminal (the command refuses it), every item
 * is done, or the user lacks `preparaciones.iniciar`. The command's other
 * rule -- one active preparación per ficha -- is what "Continuar" covers.
 */
import { esEstadoTerminal } from "./receta";
import type { EstadoReceta } from "./receta";

export interface ItemParaPreparar {
  itemRecetaId: string;
  /** Latest ficha técnica version, or `null` when none was generated. */
  fichaVigenteId: string | null;
  /** A preparación INICIADA on any of the item's fichas. */
  preparacionIniciadaId: string | null;
  tieneConfirmada: boolean;
}

export type AccionPreparacion =
  | { tipo: "ninguna" }
  | { tipo: "preparar"; fichaTecnicaId: string; etiqueta: string }
  | { tipo: "continuar"; preparacionId: string; etiqueta: string }
  | { tipo: "generar-ficha"; etiqueta: string };

export function decidirAccionPreparacion(input: { estado: EstadoReceta; items: readonly ItemParaPreparar[]; puedeIniciar: boolean }): AccionPreparacion {
  if (!input.puedeIniciar || esEstadoTerminal(input.estado)) return { tipo: "ninguna" };
  const indice = input.items.findIndex((i) => !i.tieneConfirmada);
  if (indice < 0) return { tipo: "ninguna" };

  const item = input.items[indice]!;
  const deN = input.items.length > 1 ? ` ítem ${indice + 1} de ${input.items.length}` : "";
  if (item.preparacionIniciadaId) {
    return { tipo: "continuar", preparacionId: item.preparacionIniciadaId, etiqueta: deN ? `Continuar${deN}` : "Continuar preparación" };
  }
  if (item.fichaVigenteId) return { tipo: "preparar", fichaTecnicaId: item.fichaVigenteId, etiqueta: `Preparar${deN}` };
  return { tipo: "generar-ficha", etiqueta: "Generar ficha" };
}
