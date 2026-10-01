/**
 * `confirmarFirmaRecibida` -- FASE 11 point 11.2 (M14). User decision 1
 * (2026-09-24): the courier brings back the patient's signed constancia.
 * This command, ATOMICALLY in ONE transaction: entrega.firma_recibida
 * = true + firma_recibida_en, and receta -> ENTREGADA. Permiso
 * `entregas.firma.confirmar`, audited. (Before migration 0051 it also set
 * the receta física attribute, which no longer exists.)
 *
 * Write order (see `modules/entregas/infrastructure/entrega-repository.ts`'s
 * `confirmarFirmaYEntregar` and migration 0040's header comment): entrega
 * UPDATE first, receta estado UPDATE second -- so migration 0040's
 * INV-ENT-002 trigger sees the right state at the right time.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, InvariantViolationError, NotFoundError, mapDbError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { puedeConfirmarFirmaRecibida } from "../domain/entrega";
import { lockRecetaParaAccion, getRecetaParaEntrega, getEntregaPorReceta, confirmarFirmaYEntregar } from "../infrastructure/entrega-repository";

const confirmarFirmaRecibidaInput = z.object({ recetaId: uuid });

export type ConfirmarFirmaRecibidaInput = z.infer<typeof confirmarFirmaRecibidaInput>;

export const confirmarFirmaRecibidaCommand = defineCommand({
  name: "entregas.firma.confirmar",
  permiso: "entregas.firma.confirmar",
  input: confirmarFirmaRecibidaInput,
  audit: { entidad: "entrega", accion: TipoAccion.CONFIRMAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");

    if (!puedeConfirmarFirmaRecibida(receta.estado)) {
      throw new DomainError(`La receta está en estado ${receta.estado}: no hay una firma pendiente de confirmar.`);
    }

    const entrega = await getEntregaPorReceta(tx, session.tenantId, input.recetaId);
    if (!entrega || entrega.modalidad !== "ENVIO") {
      throw new NotFoundError("No se encontró el registro de envío correspondiente a esta receta.");
    }
    if (entrega.firmaRecibida) {
      throw new DomainError("La firma de esta entrega ya fue confirmada.");
    }

    try {
      await confirmarFirmaYEntregar(tx, session.tenantId, { recetaId: input.recetaId, entregaId: entrega.id });

      return {
        output: { id: entrega.id, recetaId: input.recetaId },
        audit: {
          entidadId: entrega.id,
          valorAnterior: { firmaRecibida: false, estadoReceta: "ENVIADA_PEND_FIRMA" },
          valorNuevo: { firmaRecibida: true, estadoReceta: "ENTREGADA" },
        },
      };
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError("No se pudo confirmar la firma recibida.");
      }
      throw mapped;
    }
  },
});

export async function confirmarFirmaRecibida(input: ConfirmarFirmaRecibidaInput): Promise<{ id: string; recetaId: string }> {
  return confirmarFirmaRecibidaCommand.execute(input);
}
