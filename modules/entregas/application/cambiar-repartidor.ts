/**
 * `cambiarRepartidor` -- docs/specs/envios-repartidores.md E5. While an envío waits for its firma
 * (ENVIADA_PEND_FIRMA) its repartidor can be changed, or assigned for the first time when the envío predates
 * migration 0093 (E7). It can never be removed: INV-ENT-005 (trigger) refuses a NULL repartidor on an ENVIO, and the
 * input requires one.
 *
 * Same permiso as registering the envío (`entregas.registrar`, PIN-configurable for cuentas de sector: the Server
 * Action wraps it in `conOperador`). Takes the same receta lock as `registrarEntrega` BEFORE the fresh read (M3), so
 * two people changing or registering at once are serialized.
 *
 * Choosing the repartidor the envío already has is rejected (nothing to change, and no audit row with identical
 * before/after).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, InvariantViolationError, NotFoundError, ValidationError, mapDbError } from "@/shared/errors";
import { mensajeGlobalParaInvariante } from "@/shared/errors/mensajes-invariantes";
import { uuid } from "@/shared/validation";
import { puedeCambiarRepartidor, validarRepartidorAsignable } from "../domain/entrega";
import {
  cambiarRepartidorDeEntrega,
  getEntregaPorReceta,
  getRecetaParaEntrega,
  getRepartidorParaAsignar,
  lockRecetaParaAccion,
} from "../infrastructure/entrega-repository";

const cambiarRepartidorInput = z.object({
  recetaId: uuid,
  repartidorId: uuid,
});

export type CambiarRepartidorInput = z.input<typeof cambiarRepartidorInput>;

export const MENSAJE_MISMO_REPARTIDOR = "El envío ya tiene asignado a ese repartidor.";

export const cambiarRepartidorCommand = defineCommand({
  name: "entregas.repartidor.cambiar",
  permiso: "entregas.registrar",
  input: cambiarRepartidorInput,
  audit: { entidad: "entrega", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");
    if (!puedeCambiarRepartidor(receta.estado)) {
      throw new DomainError("El repartidor solo se puede cambiar mientras el envío espera su retorno.");
    }

    const entrega = await getEntregaPorReceta(tx, session.tenantId, input.recetaId);
    if (!entrega || entrega.modalidad !== "ENVIO") {
      throw new NotFoundError("No se encontró el registro de envío correspondiente a esta receta.");
    }
    if (entrega.repartidorId === input.repartidorId) {
      throw new ValidationError(MENSAJE_MISMO_REPARTIDOR, { fields: ["repartidorId"] });
    }

    validarRepartidorAsignable(await getRepartidorParaAsignar(tx, session.tenantId, input.repartidorId));

    try {
      await cambiarRepartidorDeEntrega(tx, session.tenantId, entrega.id, input.repartidorId);
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeGlobalParaInvariante(mapped.invariantCode) ?? "No se pudo cambiar el repartidor.", { cause: mapped });
      }
      throw mapped;
    }

    return {
      output: { id: entrega.id, recetaId: input.recetaId, repartidorId: input.repartidorId },
      audit: {
        entidadId: entrega.id,
        valorAnterior: { repartidorId: entrega.repartidorId },
        valorNuevo: { repartidorId: input.repartidorId },
      },
    };
  },
});

export async function cambiarRepartidor(input: CambiarRepartidorInput): Promise<{ id: string; recetaId: string; repartidorId: string }> {
  return cambiarRepartidorCommand.execute(input);
}
