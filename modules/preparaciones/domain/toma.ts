/**
 * The lab's "toma" of a receta (migration 0057, /preparaciones design "B").
 * Pure, no I/O.
 *
 * Taking a receta from the Pendientes queue only records who took it and
 * when: no preparación is created and the receta keeps its estado, so a
 * PENDIENTE_PREPARACION receta stays editable (recetas/domain/receta.ts's
 * `esEstadoEditable`). The formal preparación is started per ítem from the
 * toma workspace ("Confirmar terminación" -> `preparaciones.iniciar`), and
 * from then on the receta is EN_PREPARACION and locked, as before.
 *
 * Rules (enforced by application/tomar-receta.ts and cancelar-toma.ts after
 * locking the receta row):
 *   - Taking: the receta is PENDIENTE_PREPARACION or EN_PREPARACION, nobody
 *     took it yet, and at least one ítem still needs a preparación (none
 *     INICIADA or CONFIRMADA).
 *   - Cancelling: the receta is taken and no ítem has a preparación
 *     INICIADA (it has to be discarded first, from its own screen). Anyone
 *     with `preparaciones.iniciar` may cancel -- the audit records who.
 */
import { DomainError } from "@/shared/errors";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";

/** The receta estados the lab works on. */
export const ESTADOS_RECETA_EN_LABORATORIO: ReadonlySet<EstadoReceta> = new Set(["PENDIENTE_PREPARACION", "EN_PREPARACION"]);

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
  const enCurso = receta.items.find((item) => item.iniciada);
  if (enCurso) {
    throw new DomainError(`Primero hay que descartar la preparación en curso del ítem ${enCurso.posicion}.`);
  }
}

/** "1 de 2 ítems confirmados" / "0 de 1 ítem confirmado". */
export function etiquetaProgreso(confirmados: number, total: number): string {
  return total === 1 ? `${confirmados} de 1 ítem confirmado` : `${confirmados} de ${total} ítems confirmados`;
}

/** Where an ítem stands in the toma workspace. */
export type EstadoItemToma = "PENDIENTE" | "EN_CONFIRMACION" | "CONFIRMADA";

export const ESTADO_ITEM_TOMA_LABELS: Readonly<Record<EstadoItemToma, string>> = {
  PENDIENTE: "Pendiente",
  EN_CONFIRMACION: "Confirmación en curso",
  CONFIRMADA: "Confirmada",
};

/** From the ítem's active preparación (INICIADA/CONFIRMADA, any ficha version), `null` when none. */
export function estadoItemToma(preparacion: { estado: "INICIADA" | "CONFIRMADA" } | null): EstadoItemToma {
  if (!preparacion) return "PENDIENTE";
  return preparacion.estado === "CONFIRMADA" ? "CONFIRMADA" : "EN_CONFIRMACION";
}

/** The toma workspace of a receta. */
export function hrefToma(recetaId: string): string {
  return `/preparaciones/recetas/${recetaId}`;
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
