/**
 * `registrarEntrega` -- FASE 11 points 11.1/11.2 (M14). Valid from PREPARADA
 * only: the receta goes PREPARADA -> (ENTREGADA | ENVIADA_PEND_FIRMA) in a
 * single receta.estado UPDATE (LISTA_PARA_RETIRAR was removed, migration
 * 0061; the state machine trigger, migration 0011/0061, validates it). Lock
 * BEFORE the fresh read (M3 discipline, same as every other
 * recetas-adjacent command).
 *
 * Write order inside the transaction (INV-ENT-002, migration 0040, needs the
 * entrega row first): INSERT entrega -> receta: PREPARADA -> (ENTREGADA |
 * ENVIADA_PEND_FIRMA). No receta física step: the attribute and INV-R07 were
 * removed (client decision 2026-10-01, migration 0051).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, InvariantViolationError, NotFoundError, mapDbError } from "@/shared/errors";
import { mensajeGlobalParaInvariante } from "@/shared/errors/mensajes-invariantes";
import { uuid } from "@/shared/validation";
import { MODALIDADES_ENTREGA, puedeRegistrarEntrega, estadoDestinoEntrega, validarTieneItemsEntregables } from "../domain/entrega";
import {
  lockRecetaParaAccion,
  getRecetaParaEntrega,
  getItemsParaEntrega,
  actualizarEstadoReceta,
  insertEntrega,
} from "../infrastructure/entrega-repository";

const registrarEntregaInput = z.object({
  recetaId: uuid,
  modalidad: z.enum(MODALIDADES_ENTREGA),
});

export type RegistrarEntregaInput = z.infer<typeof registrarEntregaInput>;

/** Human-readable message for the M14 invariant that can still slip past the pre-checks below under a race (INV-ENT-002) -- mirrors `modules/cierres/application/firmar-cierre.ts`'s `mapDbError`-in-its-own-try/catch discipline (the pipeline's own mapping, in `withTenantTransaction`, only runs once the WHOLE handler throws, too late for a clear message here). */
function mensajeParaInvariante(codigo: string): string {
  if (codigo === "INV-ENT-002") return "No se pudo registrar la entrega: falta el registro de entrega correspondiente.";
  return mensajeGlobalParaInvariante(codigo) ?? "No se pudo registrar la entrega.";
}

export const registrarEntregaCommand = defineCommand({
  name: "entregas.registrar",
  permiso: "entregas.registrar",
  input: registrarEntregaInput,
  audit: { entidad: "entrega", accion: TipoAccion.CAMBIAR_ESTADO },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");

    if (!puedeRegistrarEntrega(receta.estado)) {
      throw new DomainError(`La receta está en estado ${receta.estado}: no admite registrar una entrega.`);
    }

    const items = await getItemsParaEntrega(tx, session.tenantId, input.recetaId);
    validarTieneItemsEntregables(items);

    try {
      const entrega = await insertEntrega(tx, {
        tenantId: session.tenantId,
        recetaId: input.recetaId,
        modalidad: input.modalidad,
        entregadaPorId: session.usuario.id,
      });

      const estadoDestino = estadoDestinoEntrega(input.modalidad);
      await actualizarEstadoReceta(tx, session.tenantId, input.recetaId, estadoDestino);

      return {
        output: { id: entrega.id, recetaId: input.recetaId, estado: estadoDestino },
        audit: {
          entidadId: entrega.id,
          valorAnterior: { estadoReceta: receta.estado },
          valorNuevo: { modalidad: input.modalidad, estadoReceta: estadoDestino },
        },
      };
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvariante(mapped.invariantCode), { cause: mapped });
      }
      throw mapped;
    }
  },
});

export async function registrarEntrega(input: RegistrarEntregaInput): Promise<{ id: string; recetaId: string; estado: string }> {
  return registrarEntregaCommand.execute(input);
}
