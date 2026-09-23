/**
 * `descartarPreparacion` (M11, FASE 8 point 8.1). FAR/DT (plan §7:
 * `preparaciones.descartar`). Only a INICIADA preparación can be discarded
 * (INV-P05 -- DB trigger, migration 0013, is the real backstop). Discarding
 * touches NO stock (task scope) -- it is the ONLY confirmation-adjacent
 * write that never opens `fsj.movimiento_stock`. The receta stays
 * EN_PREPARACION: "descarte de una preparación INICIADA con otras aún
 * pendientes ⇒ la receta permanece EN_PREPARACION (no es retroceso)" (plan
 * §9 M09) -- there is nothing to revert to PENDIENTE_PREPARACION even when
 * this was the receta's only preparación, since PENDIENTE_PREPARACION is
 * not reachable again (INV-R08: no backwards transitions).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { lockPreparacionParaAccion, getPreparacionParaAccion, updatePreparacionDescartada } from "../infrastructure/preparacion-repository";

const descartarPreparacionInput = z.object({ preparacionId: uuid, motivo: nonEmptyString });

export interface DescartarPreparacionInput {
  preparacionId: string;
  motivo: string;
}

export const descartarPreparacionCommand = defineCommand({
  name: "preparaciones.descartar",
  permiso: "preparaciones.descartar",
  input: descartarPreparacionInput,
  audit: { entidad: "preparacion", accion: TipoAccion.DESCARTAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!locked) throw new NotFoundError("Preparación no encontrada.");

    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");

    if (preparacion.estado !== "INICIADA") {
      throw new DomainError(`Solo se puede descartar una preparación INICIADA (estado actual: ${preparacion.estado}).`);
    }

    await updatePreparacionDescartada(tx, session.tenantId, input.preparacionId, {
      motivoDescarte: input.motivo,
      descartadaPorId: session.usuario.id,
    });

    return {
      output: { id: input.preparacionId },
      audit: { entidadId: input.preparacionId, motivo: input.motivo, valorNuevo: { estado: "DESCARTADA" } },
    };
  },
});

export async function descartarPreparacion(input: DescartarPreparacionInput): Promise<{ id: string }> {
  return descartarPreparacionCommand.execute(input);
}
