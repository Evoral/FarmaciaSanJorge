/**
 * `confirmarFirmaRecibida` -- FASE 11 point 11.2 (M14). User decision 1
 * (2026-09-24): the courier brings back the patient's signed constancia.
 * This command, ATOMICALLY in ONE transaction: entrega.firma_recibida
 * = true + firma_recibida_en, and receta -> ENTREGADA. Permiso
 * `entregas.registrar` (the single /entregas permiso since 0085), audited. (Before migration 0051 it also set
 * the receta física attribute, which no longer exists.)
 *
 * Write order (see `modules/entregas/infrastructure/entrega-repository.ts`'s
 * `confirmarFirmaYEntregar` and migration 0040's header comment): entrega
 * UPDATE first, receta estado UPDATE second -- so migration 0040's
 * INV-ENT-002 trigger sees the right state at the right time.
 *
 * Payment (docs/specs/pago-receta.md P4): the receta becomes ENTREGADA here, so it must end up paid -- already paid,
 * or marked paid by this same command (`pagada` input, raise-only), BEFORE the estado UPDATE (INV-R14, migration 0076).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, InvariantViolationError, NotFoundError, mapDbError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { MENSAJE_ENTREGA_REQUIERE_PAGO, puedeConfirmarFirmaRecibida, validarPagoAlEntregar } from "../domain/entrega";
import { lockRecetaParaAccion, getRecetaParaEntrega, getEntregaPorReceta, confirmarFirmaYEntregar, marcarRecetaPagada } from "../infrastructure/entrega-repository";

const confirmarFirmaRecibidaInput = z.object({
  recetaId: uuid,
  /** `true` marks the receta paid in this same transaction (raise-only, same as `registrarEntrega`'s `pagada`). */
  pagada: z.boolean().default(false),
});

/** Pre-default wire shape: `pagada` may be omitted (= false). */
export type ConfirmarFirmaRecibidaInput = z.input<typeof confirmarFirmaRecibidaInput>;

export const confirmarFirmaRecibidaCommand = defineCommand({
  name: "entregas.firma.confirmar",
  permiso: "entregas.registrar",
  input: confirmarFirmaRecibidaInput,
  audit: { entidad: "entrega", accion: TipoAccion.CONFIRMAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");

    if (!puedeConfirmarFirmaRecibida(receta.estado)) {
      throw new DomainError(`La receta está en estado ${receta.estado}: no hay un retorno pendiente de confirmar.`);
    }

    const entrega = await getEntregaPorReceta(tx, session.tenantId, input.recetaId);
    if (!entrega || entrega.modalidad !== "ENVIO") {
      throw new NotFoundError("No se encontró el registro de envío correspondiente a esta receta.");
    }
    if (entrega.firmaRecibida) {
      throw new DomainError("El retorno de esta entrega ya fue confirmado.");
    }

    validarPagoAlEntregar({ yaPagada: receta.pagada, pagarAhora: input.pagada });

    try {
      const marcarPago = input.pagada && !receta.pagada;
      if (marcarPago) {
        await marcarRecetaPagada(tx, session.tenantId, input.recetaId, session.usuario.id);
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: "receta",
          entidadId: input.recetaId,
          accion: TipoAccion.MODIFICAR,
          valorAnterior: { pagada: false },
          valorNuevo: { pagada: true },
          contexto: { origen: "entrega" },
        });
      }

      await confirmarFirmaYEntregar(tx, session.tenantId, { recetaId: input.recetaId, entregaId: entrega.id });

      return {
        output: { id: entrega.id, recetaId: input.recetaId },
        audit: {
          entidadId: entrega.id,
          valorAnterior: { firmaRecibida: false, estadoReceta: "ENVIADA_PEND_FIRMA", pagada: receta.pagada },
          valorNuevo: { firmaRecibida: true, estadoReceta: "ENTREGADA", pagada: true },
        },
      };
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mapped.invariantCode === "INV-R14" ? MENSAJE_ENTREGA_REQUIERE_PAGO : "No se pudo confirmar el retorno.", { cause: mapped });
      }
      throw mapped;
    }
  },
});

export async function confirmarFirmaRecibida(input: ConfirmarFirmaRecibidaInput): Promise<{ id: string; recetaId: string }> {
  return confirmarFirmaRecibidaCommand.execute(input);
}
