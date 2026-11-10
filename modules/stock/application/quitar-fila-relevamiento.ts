/**
 * `quitarFilaRelevamiento` (openspec/changes/planilla-existencia-inicial).
 * Removes a draft row from the planilla de existencia inicial.
 * Permiso `stock.relevamiento.editar` (not PIN-configurable).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { deleteFilaRelevamiento } from "../infrastructure/relevamiento-fila-repository";

const quitarFilaRelevamientoInput = z.object({
  id: uuid,
});

export type QuitarFilaRelevamientoInput = z.infer<typeof quitarFilaRelevamientoInput>;

export const quitarFilaRelevamientoCommand = defineCommand({
  name: "stock.relevamiento.quitar_fila",
  permiso: "stock.relevamiento.editar",
  input: quitarFilaRelevamientoInput,
  audit: { entidad: "relevamiento_fila", accion: TipoAccion.BAJA },
  handler: async ({ tx, session, input }) => {
    await deleteFilaRelevamiento(tx, session.tenantId, input.id);
    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
      },
    };
  },
});

export async function quitarFilaRelevamiento(input: QuitarFilaRelevamientoInput) {
  return quitarFilaRelevamientoCommand.execute(input);
}
