/**
 * `marcarListaParaRetirar` -- FASE 11 point 11.1 (M14). User decision 2
 * (2026-09-24): PREPARADA -> LISTA_PARA_RETIRAR, permiso `entregas.registrar`,
 * audited. Independent of `registrarEntrega` (which can also perform this
 * SAME transition internally when called directly from PREPARADA) --
 * this command exists for the case where staff wants to mark a receta
 * ready without delivering it yet.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { puedeMarcarListaParaRetirar } from "../domain/entrega";
import { lockRecetaParaAccion, getRecetaParaEntrega, actualizarEstadoReceta } from "../infrastructure/entrega-repository";

const marcarListaParaRetirarInput = z.object({ recetaId: uuid });

export type MarcarListaParaRetirarInput = z.infer<typeof marcarListaParaRetirarInput>;

export const marcarListaParaRetirarCommand = defineCommand({
  name: "entregas.listaParaRetirar.marcar",
  permiso: "entregas.registrar",
  input: marcarListaParaRetirarInput,
  audit: { entidad: "receta", accion: TipoAccion.CAMBIAR_ESTADO },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");

    if (!puedeMarcarListaParaRetirar(receta.estado)) {
      throw new DomainError(`La receta está en estado ${receta.estado}: solo se puede marcar lista para retirar desde PREPARADA.`);
    }

    await actualizarEstadoReceta(tx, session.tenantId, input.recetaId, "LISTA_PARA_RETIRAR");

    return {
      output: { id: input.recetaId },
      audit: { entidadId: input.recetaId, valorAnterior: { estado: "PREPARADA" }, valorNuevo: { estado: "LISTA_PARA_RETIRAR" } },
    };
  },
});

export async function marcarListaParaRetirar(input: MarcarListaParaRetirarInput): Promise<{ id: string }> {
  return marcarListaParaRetirarCommand.execute(input);
}
