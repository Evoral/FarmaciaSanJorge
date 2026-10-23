/**
 * The lab's "toma" of a receta (migration 0057, /preparaciones design "B").
 * Pure, no I/O.
 *
 * Taking a receta from the Pendientes queue only records who took it and
 * when: no preparación is created and the receta keeps its estado, so a
 * PENDIENTE_PREPARACION receta stays editable (recetas/domain/receta.ts's
 * `esEstadoEditable`). The formal preparación is created per ítem from the
 * toma workspace when its stock is reserved ("Continuar" -> "Reservar
 * stock", `preparaciones.reservarStock`); while that preparación is live the
 * receta can not be edited. The ítems are confirmed (stock, libro recetario)
 * together at the receta's "Imprimir etiquetas", once every one holds a
 * reserva, and the receta moves to PREPARADA (an ítem confirmed earlier on
 * its preparación's own screen moved it to EN_PREPARACION;
 * docs/specs/reserva-stock-preparacion.md); releasing a reserva before that
 * leaves it PENDIENTE_PREPARACION and editable.
 *
 * Rules (enforced by application/tomar-receta.ts and cancelar-toma.ts after
 * locking the receta row):
 *   - Taking: the receta is PENDIENTE_PREPARACION or EN_PREPARACION, nobody
 *     took it yet, and at least one ítem still needs a preparación (none
 *     INICIADA or CONFIRMADA).
 *   - Cancelling: the receta is taken and no ítem has a preparación
 *     INICIADA (it has to be discarded first, from its own screen) nor
 *     CONFIRMADA (already in the libro recetario: the lab's work on the
 *     receta started for good). Anyone with `preparaciones.iniciar` may
 *     cancel -- the audit records who.
 */
import { DomainError } from "@/shared/errors";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";

/** The receta estados the lab works on. */
export const ESTADOS_RECETA_EN_LABORATORIO: ReadonlySet<EstadoReceta> = new Set(["PENDIENTE_PREPARACION", "EN_PREPARACION"]);

/**
 * The receta estados the toma workspace (/preparaciones/recetas/[recetaId]) shows a TAKEN receta in: the lab's, plus
 * PREPARADA -- its "Imprimir etiquetas" confirms the last ítems and moves it there, and the workspace stays (read-only,
 * every ítem Confirmada) so the etiquetas can be printed and reprinted. Any other estado (ENTREGADA, ANULADA...) goes to
 * the receta's detail page. Only the page reads it: taking and cancelling still follow ESTADOS_RECETA_EN_LABORATORIO.
 */
export const ESTADOS_RECETA_VISIBLES_EN_TOMA: ReadonlySet<EstadoReceta> = new Set([...ESTADOS_RECETA_EN_LABORATORIO, "PREPARADA"]);

export interface EstadoItemParaToma {
  /** 1-based, as the receta detail page numbers its ítems. */
  posicion: number;
  iniciada: boolean;
  confirmada: boolean;
}

export interface RecetaParaToma {
  numeroInterno: string;
  estado: EstadoReceta;
  tomadaPorId: string | null;
  /** "Apellido, Nombre" of whoever took it. */
  tomadaPorNombre: string | null;
  /** Already formatted (dd/mm/aaaa hh:mm, the farmacia's zona horaria). */
  tomadaEnTexto: string | null;
  items: readonly EstadoItemParaToma[];
}

/** An ítem still needs a preparación when none is INICIADA or CONFIRMADA (a DESCARTADA one puts it back). */
export function itemNecesitaPreparacion(item: Pick<EstadoItemParaToma, "iniciada" | "confirmada">): boolean {
  return !item.iniciada && !item.confirmada;
}

/** Throws `DomainError` with the reason the receta cannot be taken by `usuarioId`. */
export function validarTomarReceta(receta: RecetaParaToma, usuarioId: string): void {
  if (!ESTADOS_RECETA_EN_LABORATORIO.has(receta.estado)) {
    throw new DomainError(`La receta Nº ${receta.numeroInterno} no se puede tomar: no está pendiente de preparación.`);
  }
  if (receta.tomadaPorId !== null) {
    const cuando = receta.tomadaEnTexto ? ` el ${receta.tomadaEnTexto}` : "";
    throw new DomainError(
      receta.tomadaPorId === usuarioId
        ? `Ya tomaste la receta Nº ${receta.numeroInterno}${cuando}. Está en la pestaña En curso.`
        : `La receta Nº ${receta.numeroInterno} ya fue tomada por ${receta.tomadaPorNombre ?? "otro usuario"}${cuando}.`,
    );
  }
  if (!receta.items.some(itemNecesitaPreparacion)) {
    throw new DomainError(`La receta Nº ${receta.numeroInterno} no tiene ítems pendientes de preparación.`);
  }
}

/** Throws `DomainError` with the reason the toma cannot be cancelled. */
export function validarCancelarToma(receta: Pick<RecetaParaToma, "numeroInterno" | "tomadaPorId" | "items">): void {
  if (receta.tomadaPorId === null) {
    throw new DomainError(`La receta Nº ${receta.numeroInterno} no está tomada.`);
  }
  const confirmado = receta.items.find((item) => item.confirmada);
  if (confirmado) {
    throw new DomainError(`El ítem ${confirmado.posicion} ya está confirmado y asentado en el libro recetario: la toma no se puede cancelar.`);
  }
  const enCurso = receta.items.find((item) => item.iniciada);
  if (enCurso) {
    throw new DomainError(`Primero hay que liberar la reserva de stock (o descartar la preparación en curso) del ítem ${enCurso.posicion}.`);
  }
}

/** "1 de 2 ítems confirmados" / "0 de 1 ítem confirmado". */
export function etiquetaProgreso(confirmados: number, total: number): string {
  return total === 1 ? `${confirmados} de 1 ítem confirmado` : `${confirmados} de ${total} ítems confirmados`;
}

/**
 * Where an ítem stands in the toma workspace: RESERVADA = a preparación
 * INICIADA holding a reserva de stock (migration 0071); EN_CONFIRMACION = an
 * INICIADA one WITHOUT reservas (from before 0071, or the ficha técnica
 * screen's former "Preparar"), confirmed or discarded on its own screen.
 */
export type EstadoItemToma = "PENDIENTE" | "EN_CONFIRMACION" | "RESERVADA" | "CONFIRMADA";

export const ESTADO_ITEM_TOMA_LABELS: Readonly<Record<EstadoItemToma, string>> = {
  PENDIENTE: "Pendiente",
  EN_CONFIRMACION: "Confirmación en curso",
  RESERVADA: "Stock reservado",
  CONFIRMADA: "Confirmada",
};

/** From the ítem's active preparación (INICIADA/CONFIRMADA, any ficha version), `null` when none. */
export function estadoItemToma(preparacion: { estado: "INICIADA" | "CONFIRMADA"; reservas: readonly unknown[] } | null): EstadoItemToma {
  if (!preparacion) return "PENDIENTE";
  if (preparacion.estado === "CONFIRMADA") return "CONFIRMADA";
  return preparacion.reservas.length > 0 ? "RESERVADA" : "EN_CONFIRMACION";
}

/**
 * The workspace's "Imprimir etiquetas" confirms the receta all at once (docs/specs/reserva-stock-preparacion.md, R13):
 * every ítem not yet Confirmada must hold a reserva. The 1-based numbers ("Ítem N") of those that do not -- Pendiente or
 * "Confirmación en curso"; empty = it may confirm.
 */
export function itemsSinReserva(estados: readonly EstadoItemToma[]): number[] {
  return estados.flatMap((estado, i) => (estado === "CONFIRMADA" || estado === "RESERVADA" ? [] : [i + 1]));
}

/** "el ítem 2 no tiene" / "los ítems 1, 2 y 4 no tienen" stock reservado: why "Imprimir etiquetas" is refused. */
export function mensajeItemsSinReserva(numeros: readonly number[]): string {
  const sujeto =
    numeros.length === 1 ? `el ítem ${numeros[0]} no tiene` : `los ítems ${numeros.slice(0, -1).join(", ")} y ${numeros[numeros.length - 1]} no tienen`;
  return `No se pueden imprimir las etiquetas: ${sujeto} stock reservado. Reservá el stock de todos los ítems para imprimirlas.`;
}

/** The toma workspace of a receta. */
export function hrefToma(recetaId: string): string {
  return `/preparaciones/recetas/${recetaId}`;
}

/** Toma workspace URL flag: open "Imprimir etiquetas" on load (the Confirmadas tab's "Imprimir", reserva spec R26). */
export const PARAM_IMPRIMIR = "imprimir";

export function hrefImprimirEtiquetas(recetaId: string): string {
  return `${hrefToma(recetaId)}?${PARAM_IMPRIMIR}=1`;
}

/** The "En curso" tab (its URL key is still `estado=INICIADA`, so older links keep working). */
export const HREF_EN_CURSO = "/preparaciones?estado=INICIADA";

/**
 * `/preparaciones/[id]`'s "Volver": back to the receta's toma workspace while
 * the receta is taken, still in the lab and has ítems to confirm (the lab
 * goes on with the next one -- also after discarding, to start again);
 * otherwise the list tab that shows this preparación.
 */
export function hrefVolverDePreparacion(
  estadoPreparacion: string,
  receta: { recetaId: string; estado: EstadoReceta; tomada: boolean; itemsSinConfirmar: number } | null,
): string {
  if (receta && receta.tomada && receta.itemsSinConfirmar > 0 && ESTADOS_RECETA_EN_LABORATORIO.has(receta.estado)) {
    return hrefToma(receta.recetaId);
  }
  return `/preparaciones?estado=${estadoPreparacion}`;
}

/**
 * The Pendientes row's "Ítems" cell: the pending ítems' names (up to three),
 * else their count; plus how many of the receta's ítems are still pending
 * when some are already done or in progress.
 */
export function resumenItemsPendientes(nombres: readonly string[], totalItems: number): string {
  const lista = nombres.length <= 3 ? nombres.join(" · ") : `${nombres.length} ítems`;
  return nombres.length < totalItems ? `${lista} (${nombres.length} de ${totalItems} pendientes)` : lista;
}
