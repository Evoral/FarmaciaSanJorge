/**
 * `confirmarFirmaRecibida` -- FASE 11 point 11.2 (M14). User decision 1
 * (2026-09-24): the courier returns the patient's signed constancia
 * TOGETHER WITH the receta's physical original. This command, ATOMICALLY
 * in ONE transaction: sets receta_fisica_recibida (+ _en/_por_id, only if
 * not already set), entrega.firma_recibida = true + firma_recibida_en, and
 * receta -> ENTREGADA. Permiso `entregas.firma.confirmar`, audited.
 *
 * Write order (see `modules/entregas/infrastructure/entrega-repository.ts`'s
 * `confirmarFirmaYEntregar` and migration 0040's header comment): entrega
 * UPDATE first, receta UPDATE (receta_fisica_recibida + estado, in ONE
 * statement) second -- so both migration 0040 triggers (INV-ENT-002,
 * INV-ENT-003) see the right state at the right time.
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
      await confirmarFirmaYEntregar(tx, session.tenantId, {
        recetaId: input.recetaId,
        entregaId: entrega.id,
        usuarioId: session.usuario.id,
        recetaFisicaYaRecibida: receta.recetaFisicaRecibida,
      });

      return {
        output: { id: entrega.id, recetaId: input.recetaId },
        audit: {
          entidadId: entrega.id,
          valorAnterior: { firmaRecibida: false, estadoReceta: "ENVIADA_PEND_FIRMA" },
          valorNuevo: { firmaRecibida: true, estadoReceta: "ENTREGADA", recetaFisicaRecibida: true },
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
