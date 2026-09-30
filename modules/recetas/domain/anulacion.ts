/**
 * Whether a receta may be anulled DIRECTLY (`recetas.anular`), and if not,
 * why -- shared by the command (the real guard) and the detail page (what
 * to offer). Pure, no I/O.
 *
 * docs/specs/libro-recetario-y-contralor.md §1 (D2 REVISED): once a
 * preparación is CONFIRMADA its SISTEMA asiento records it in the legal
 * libro. Anulling the receta directly would leave that asiento VIGENTE --
 * the receta would say ANULADA while the libro still records the
 * preparación. The legal path is to anular/rectificar the asiento from the
 * Libro (DT co-signature); once every item is "sin efecto", D2 anulls the
 * receta automatically. So a direct anulación is refused while any
 * asiento is still in effect.
 *
 * A preparación still INICIADA also blocks it: nothing prevents confirming
 * that preparación afterwards, which would register a new asiento for an
 * already ANULADA receta -- the same inconsistency, one step later. The
 * preparación has to be descartada first.
 */
import { esEstadoTerminal } from "./receta";
import type { EstadoReceta } from "./receta";

export const MENSAJE_ANULACION_BLOQUEADA_POR_LIBRO =
  "Esta receta ya tiene preparaciones registradas en el libro recetario. Para anularla, dejá sin efecto esos asientos desde el Libro recetario (requiere autorización del Director Técnico). La receta se anulará automáticamente.";

export const AYUDA_ANULACION_PERMITIDA = "La receta quedará anulada y no se podrá preparar ni entregar.";

export function mensajePreparacionEnCurso(item: number): string {
  return `No se puede anular la receta: el ítem ${item} tiene una preparación en curso. Descartala desde Preparaciones y volvé a intentar.`;
}

export interface AsientoEnEfectoRef {
  itemRecetaId: string;
  asientoId: string;
  numeroCorrelativo: string;
}

export interface AsientoBloqueante {
  asientoId: string;
  numeroCorrelativo: string;
  /** 1-based position of its item in `itemIds` ("ítem N", detail-page order). */
  item: number;
}

export type DecisionAnulacion =
  | { tipo: "terminal" }
  | { tipo: "bloqueada-libro"; asientos: AsientoBloqueante[] }
  | { tipo: "bloqueada-preparacion"; item: number }
  | { tipo: "permitida" };

export function decidirAnulacion(input: {
  estado: EstadoReceta;
  /** The receta's item ids, in the order the detail page lists them. */
  itemIds: readonly string[];
  /** Confirmed preparaciones whose SISTEMA asiento is not "sin efecto" (D2). */
  asientosEnEfecto: readonly AsientoEnEfectoRef[];
  /** Items with a preparación still INICIADA. */
  itemsConPreparacionIniciada: readonly string[];
}): DecisionAnulacion {
  if (esEstadoTerminal(input.estado)) return { tipo: "terminal" };
  const numero = (itemRecetaId: string) => input.itemIds.indexOf(itemRecetaId) + 1;
  if (input.asientosEnEfecto.length > 0) {
    return {
      tipo: "bloqueada-libro",
      asientos: input.asientosEnEfecto.map((a) => ({ asientoId: a.asientoId, numeroCorrelativo: a.numeroCorrelativo, item: numero(a.itemRecetaId) })),
    };
  }
  const enCurso = input.itemIds.findIndex((id) => input.itemsConPreparacionIniciada.includes(id));
  if (enCurso >= 0) return { tipo: "bloqueada-preparacion", item: enCurso + 1 };
  return { tipo: "permitida" };
}
