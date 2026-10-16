/**
 * D8 (docs/specs/libro-recetario-y-contralor.md §1, 2026-10-16): ONE asiento per receta. Pure rules for what that
 * asiento says and for when the legacy single-preparación path may write it. Persisted by
 * ../application/registrar-asiento-receta.ts (migration 0082).
 */
import { DomainError } from "@/shared/errors";

/** One detalle line of an ítem, in the ítem's own (ficha) order. */
export interface DetalleDeItem {
  lineaPesajeId: string;
  descripcion: string;
  cantidad: string;
  unidadTexto: string;
  orden: number;
}

/** What one confirmed ítem contributes to the receta's asiento. `numero` is the ítem's 1-based position in the receta ("Ítem N"). */
export interface ItemDelAsiento {
  numero: number;
  preparacionId: string;
  /** The ítem's own fórmula text (`formatearFormulaTexto`, ./preparacion.ts). */
  formulaTexto: string;
  detalles: readonly DetalleDeItem[];
}

function enOrdenDeItem<T extends { numero: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.numero - b.numero);
}

/** `formula_texto`: each ítem's fórmula in ítem order, prefixed by "Ítem N: " and joined by " | ". */
export function formatearFormulaReceta(items: readonly Pick<ItemDelAsiento, "numero" | "formulaTexto">[]): string {
  return enOrdenDeItem(items)
    .map((item) => `Ítem ${item.numero}: ${item.formulaTexto}`)
    .join(" | ");
}

/** `detalle_asiento`: every ítem's lines, in ítem order and, within each, in its own order; `orden` is renumbered 1..n across the whole asiento. */
export function ensamblarDetallesReceta(items: readonly Pick<ItemDelAsiento, "numero" | "detalles">[]): DetalleDeItem[] {
  return enOrdenDeItem(items)
    .flatMap((item) => [...item.detalles].sort((a, b) => a.orden - b.orden))
    .map((detalle, indice) => ({ ...detalle, orden: indice + 1 }));
}

/** `asiento_preparacion`: the preparaciones in ítem order, `orden` 1..n. */
export function preparacionesDelAsiento(items: readonly Pick<ItemDelAsiento, "numero" | "preparacionId">[]): { preparacionId: string; orden: number }[] {
  return enOrdenDeItem(items).map((item, indice) => ({ preparacionId: item.preparacionId, orden: indice + 1 }));
}

export const MENSAJE_RECETA_CON_VARIOS_ITEMS = "Esta receta tiene varios ítems: se registran juntos en el libro desde la toma (Imprimir etiquetas).";

/** An ítem of the receta as the legacy single path sees it: the estado of its live preparación (`null` = none). */
export interface ItemDeRecetaParaConfirmar {
  itemRecetaId: string;
  estadoPreparacion: "INICIADA" | "CONFIRMADA" | null;
}

/**
 * The legacy single path (`preparaciones.confirmar`, /preparaciones/[id]) writes a por-receta asiento with that one
 * preparación, so it is refused while ANOTHER ítem of the receta is not CONFIRMADA (pending, or with a preparación
 * INICIADA): those ítems would need a second asiento for the same receta (INV-L24). Ítems already CONFIRMADA before
 * D8 keep their own per-ítem asiento and do not block.
 */
export function validarConfirmacionIndividual(items: readonly ItemDeRecetaParaConfirmar[], itemRecetaId: string): void {
  if (items.some((item) => item.itemRecetaId !== itemRecetaId && item.estadoPreparacion !== "CONFIRMADA")) {
    throw new DomainError(MENSAJE_RECETA_CON_VARIOS_ITEMS);
  }
}
