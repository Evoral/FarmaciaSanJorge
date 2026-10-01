/**
 * Pure domain rules for M14 (entregas), FASE 11 points 11.1-11.2. No I/O, no Prisma (eslint's domainBoundaryPatterns enforce
 * this structurally). `EstadoReceta` is imported from `modules/recetas/domain`
 * (importing another module's `domain/` is allowed -- only `infrastructure/`
 * is off limits, see eslint.config.mjs's `domainBoundaryPatterns`), so this
 * file never risks drifting from the real state machine.
 *
 * Source of truth for the state machine itself: migration 0011's
 * `fsj.receta_validar_transicion_estado` (mirrored in
 * modules/recetas/domain/receta.ts). Source of truth for the M14-specific
 * invariants: migration 0016 (INV-ENT-001) and migration 0040 (INV-ENT-002;
 * INV-R07 was superseded by migration 0051) -- the helpers below are fast, clear-message
 * app-level pre-checks; the DB remains the real backstop.
 */
import { ValidationError } from "@/shared/errors";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";

export type ModalidadEntrega = "RETIRO_PRESENCIAL" | "ENVIO";
export const MODALIDADES_ENTREGA = ["RETIRO_PRESENCIAL", "ENVIO"] as const satisfies readonly ModalidadEntrega[];

/**
 * User decision 2 (2026-09-24): registering an entrega directly from
 * PREPARADA is allowed -- the command performs
 * PREPARADA -> LISTA_PARA_RETIRAR -> (ENTREGADA | ENVIADA_PEND_FIRMA) in
 * the same transaction. LISTA_PARA_RETIRAR is also accepted directly (the
 * receta already went through "marcar lista para retirar").
 */
export function puedeRegistrarEntrega(estado: EstadoReceta): boolean {
  return estado === "PREPARADA" || estado === "LISTA_PARA_RETIRAR";
}

/** User decision 2: "Marcar lista para retirar" is only valid from PREPARADA. */
export function puedeMarcarListaParaRetirar(estado: EstadoReceta): boolean {
  return estado === "PREPARADA";
}

/** User decision 1: "Confirmar firma recibida" is only valid while the envío is pending its firma. */
export function puedeConfirmarFirmaRecibida(estado: EstadoReceta): boolean {
  return estado === "ENVIADA_PEND_FIRMA";
}

/**
 * D2 revisado (FASE 9): an item is deliverable only while its SISTEMA
 * asiento is VIGENTE (`estadoAsiento`, same three-value shape as
 * `modules/recetas/infrastructure/receta-repository.ts`'s `ItemDetalle.estadoAsiento`).
 * SIN_EFECTO items are excluded ("Excluido — no se entrega"); PENDIENTE
 * should not occur once the receta reached PREPARADA/LISTA_PARA_RETIRAR
 * (every item needs a CONFIRMADA preparación to get there), but is treated
 * as non-deliverable too, defensively.
 */
export interface ItemParaEntrega {
  id: string;
  estadoAsiento: "PENDIENTE" | "VIGENTE" | "SIN_EFECTO";
}

export function calcularItemsEntregables(items: readonly ItemParaEntrega[]): { entregables: string[]; excluidos: string[] } {
  const entregables: string[] = [];
  const excluidos: string[] = [];
  for (const item of items) {
    if (item.estadoAsiento === "VIGENTE") {
      entregables.push(item.id);
    } else {
      excluidos.push(item.id);
    }
  }
  return { entregables, excluidos };
}

/** User decision 3: no partial deliveries -- if every item is excluded there is nothing to deliver (the receta should already be ANULADA at that point; this is a defensive re-check, not the primary gate -- see modules/libro/infrastructure/receta-coupling-repository.ts#todosLosItemsSinEfecto). */
export function validarTieneItemsEntregables(items: readonly ItemParaEntrega[]): void {
  const { entregables } = calcularItemsEntregables(items);
  if (entregables.length === 0) {
    throw new ValidationError("La receta no tiene ítems para entregar: todos quedaron sin efecto.");
  }
}

/** The receta.estado the entrega command must reach for a given modalidad. */
export function estadoDestinoEntrega(modalidad: ModalidadEntrega): EstadoReceta {
  return modalidad === "RETIRO_PRESENCIAL" ? "ENTREGADA" : "ENVIADA_PEND_FIRMA";
}
