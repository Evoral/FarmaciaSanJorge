/**
 * `registrarEntrega` -- FASE 11 points 11.1/11.2 (M14). User decision 2
 * (2026-09-24): valid from PREPARADA or LISTA_PARA_RETIRAR -- when starting
 * at PREPARADA, this command performs
 * PREPARADA -> LISTA_PARA_RETIRAR -> (ENTREGADA | ENVIADA_PEND_FIRMA) in
 * the SAME transaction (two receta.estado UPDATEs; migration 0011's state
 * machine trigger validates each one individually -- a single UPDATE
 * cannot skip the intermediate value). Lock BEFORE the fresh read (M3
 * discipline, same as every other recetas-adjacent command).
 *
 * Write order inside the transaction (see migration 0040's header comment
 * for why): [registrar recepción física, IF the checkbox path applies] ->
 * [receta: PREPARADA -> LISTA_PARA_RETIRAR, IF needed] -> INSERT entrega ->
 * receta: -> (ENTREGADA | ENVIADA_PEND_FIRMA).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, InvariantViolationError, NotFoundError, mapDbError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { MODALIDADES_ENTREGA, puedeRegistrarEntrega, estadoDestinoEntrega, requiereRegistrarRecepcionFisicaAhora, validarTieneItemsEntregables } from "../domain/entrega";
import {
  lockRecetaParaAccion,
  getRecetaParaEntrega,
  getItemsParaEntrega,
  marcarRecepcionFisica,
  actualizarEstadoReceta,
  insertEntrega,
} from "../infrastructure/entrega-repository";

const registrarEntregaInput = z.object({
  recetaId: uuid,
  modalidad: z.enum(MODALIDADES_ENTREGA),
  /** Required (checked by domain logic) only for RETIRO_PRESENCIAL when receta_fisica_recibida is still false -- user decision 5. */
  confirmaRecepcionFisica: z.boolean().optional().default(false),
});

export type RegistrarEntregaInput = z.infer<typeof registrarEntregaInput>;

/** Human-readable message for the two M14 invariants that can still slip past the pre-checks below under a race (INV-R07, INV-ENT-002) -- mirrors `modules/cierres/application/firmar-cierre.ts`'s `mapDbError`-in-its-own-try/catch discipline (the pipeline's own mapping, in `withTenantTransaction`, only runs once the WHOLE handler throws, too late for a clear message here). */
function mensajeParaInvariante(codigo: string): string {
  if (codigo === "INV-R07") return "No se puede registrar el retiro presencial sin la receta física recibida.";
  if (codigo === "INV-ENT-002") return "No se pudo registrar la entrega: falta el registro de entrega correspondiente.";
  return "No se pudo registrar la entrega.";
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

    const debeRegistrarFisicaAhora = requiereRegistrarRecepcionFisicaAhora(input.modalidad, receta.recetaFisicaRecibida, input.confirmaRecepcionFisica);

    try {
      if (debeRegistrarFisicaAhora) {
        await marcarRecepcionFisica(tx, session.tenantId, input.recetaId, session.usuario.id);
      }

      if (receta.estado === "PREPARADA") {
        await actualizarEstadoReceta(tx, session.tenantId, input.recetaId, "LISTA_PARA_RETIRAR");
      }

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
          valorNuevo: { modalidad: input.modalidad, estadoReceta: estadoDestino, recetaFisicaRegistradaAhora: debeRegistrarFisicaAhora },
        },
      };
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvariante(mapped.invariantCode));
      }
      throw mapped;
    }
  },
});

export async function registrarEntrega(input: RegistrarEntregaInput): Promise<{ id: string; recetaId: string; estado: string }> {
  return registrarEntregaCommand.execute(input);
}
