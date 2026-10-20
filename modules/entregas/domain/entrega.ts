/**
 * Pure domain rules for M14 (entregas), FASE 11 points 11.1-11.2. No I/O, no Prisma (eslint's domainBoundaryPatterns enforce
 * this structurally). `EstadoReceta` is imported from `modules/recetas/domain`
 * (importing another module's `domain/` is allowed -- only `infrastructure/`
 * is off limits, see eslint.config.mjs's `domainBoundaryPatterns`), so this
 * file never risks drifting from the real state machine.
 *
 * Source of truth for the state machine itself: migration 0011's
 * `fsj.receta_validar_transicion_estado` (last redefined by 0061; mirrored in
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
 * An entrega is registered directly from PREPARADA: the command moves the
 * receta PREPARADA -> (ENTREGADA | ENVIADA_PEND_FIRMA) in a single UPDATE
 * (LISTA_PARA_RETIRAR was removed, migration 0061).
 */
export function puedeRegistrarEntrega(estado: EstadoReceta): boolean {
  return estado === "PREPARADA";
}

/** docs/specs/anular-entrega.md A1: an entrega registered by mistake is reverted from either estado it reaches. */
export function puedeAnularEntrega(estado: EstadoReceta): boolean {
  return estado === "ENTREGADA" || estado === "ENVIADA_PEND_FIRMA";
}

export const MENSAJE_ANULAR_ENTREGA_ARCHIVADA = "La receta ya está en un lote de archivo: su entrega no se puede anular.";
export const MENSAJE_ANULAR_ENTREGA_SIN_ITEMS =
  "Todos los ítems de la receta quedaron sin efecto en el libro: no volvería a poder entregarse, así que su entrega no se anula.";

/** docs/specs/anular-entrega.md A3: refused for an archived receta, and when the receta would come back with nothing left to deliver. */
export function validarAnularEntrega(input: { archivada: boolean; items: readonly ItemParaEntrega[] }): void {
  if (input.archivada) throw new ValidationError(MENSAJE_ANULAR_ENTREGA_ARCHIVADA);
  if (calcularItemsEntregables(input.items).entregables.length === 0) throw new ValidationError(MENSAJE_ANULAR_ENTREGA_SIN_ITEMS);
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
 * should not occur once the receta reached PREPARADA
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

// ============================================================================
// Envíos con repartidor (docs/specs/envios-repartidores.md E1-E5).
// ============================================================================

export const MENSAJE_ENVIO_SIN_REPARTIDOR = "Elija el repartidor que lleva el envío.";
export const MENSAJE_RETIRO_CON_REPARTIDOR = "Un retiro presencial no lleva repartidor.";
export const MENSAJE_ENVIO_SIN_DOMICILIO = "Cargue el domicilio en la receta antes de registrar un envío.";
export const MENSAJE_REPARTIDOR_NO_ENCONTRADO = "El repartidor elegido no existe.";
export const MENSAJE_REPARTIDOR_INACTIVO = "El repartidor elegido está inactivo: elija otro.";

/**
 * E1/E2: an ENVIO carries exactly one repartidor and a RETIRO_PRESENCIAL none. Returns the message to show on the
 * repartidor field, or null when the combination is valid. DB backstops: INV-ENT-005 (trigger) and the
 * `entrega_repartidor_solo_envio_check` CHECK (migration 0093).
 */
export function mensajeRepartidorSegunModalidad(modalidad: ModalidadEntrega, repartidorId: string | null | undefined): string | null {
  const tiene = repartidorId != null && repartidorId !== "";
  if (modalidad === "ENVIO" && !tiene) return MENSAJE_ENVIO_SIN_REPARTIDOR;
  if (modalidad === "RETIRO_PRESENCIAL" && tiene) return MENSAJE_RETIRO_CON_REPARTIDOR;
  return null;
}

/** E4: the domicilio of an envío is the receta's `domicilio_paciente`; blank (null, empty or whitespace) means there is none. */
export function recetaTieneDomicilio(domicilioPaciente: string | null | undefined): boolean {
  return domicilioPaciente != null && domicilioPaciente.trim().length > 0;
}

/** E4: throws unless the receta has a domicilio to send to. */
export function validarDomicilioParaEnvio(domicilioPaciente: string | null | undefined): void {
  if (!recetaTieneDomicilio(domicilioPaciente)) throw new ValidationError(MENSAJE_ENVIO_SIN_DOMICILIO);
}

/** E3: only an existing, active repartidor of the tenant (`null` = not found in the tenant) can be assigned to an envío. */
export function validarRepartidorAsignable(repartidor: { activo: boolean } | null): void {
  if (!repartidor) throw new ValidationError(MENSAJE_REPARTIDOR_NO_ENCONTRADO, { fields: ["repartidorId"] });
  if (!repartidor.activo) throw new ValidationError(MENSAJE_REPARTIDOR_INACTIVO, { fields: ["repartidorId"] });
}

/** E5: the repartidor of an envío can be changed only while the receta waits for its firma. */
export function puedeCambiarRepartidor(estado: EstadoReceta): boolean {
  return estado === "ENVIADA_PEND_FIRMA";
}

export const MENSAJE_ENTREGA_REQUIERE_PAGO ="Para entregar la receta tiene que quedar pagada: activá “Marcar como pagada”.";

/**
 * Pago rule (docs/specs/pago-receta.md P4, user decision 2026-10-13): a receta only reaches ENTREGADA paid, so every
 * delivered receta keeps its payment record. RETIRO_PRESENCIAL reaches ENTREGADA at registration; an ENVIO may stay
 * unpaid while ENVIADA_PEND_FIRMA and must be paid when its firma is confirmed. DB backstop: INV-R14 (migration 0076).
 */
export function entregaExigePago(modalidad: ModalidadEntrega): boolean {
  return estadoDestinoEntrega(modalidad) === "ENTREGADA";
}

/** Throws unless the receta ends up paid: already paid, or marked paid in this same action (`pagarAhora`). */
export function validarPagoAlEntregar(input: { yaPagada: boolean; pagarAhora: boolean }): void {
  if (!input.yaPagada && !input.pagarAhora) {
    throw new ValidationError(MENSAJE_ENTREGA_REQUIERE_PAGO, { fields: ["pagada"] });
  }
}
