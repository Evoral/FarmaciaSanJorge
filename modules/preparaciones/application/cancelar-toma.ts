/**
 * `cancelarToma` (M11, /preparaciones design "B"): reverts a toma -- the
 * receta goes back to the Pendientes queue (`tomada_por_id`/`tomada_en`
 * cleared, migration 0056). Refused while an ítem has a preparación
 * INICIADA: it must be discarded first, from its own screen (domain/toma.ts).
 * Any user with `preparaciones.iniciar` may cancel, not only whoever took
 * it (the lab shares the queue); the audit records who did.
 *
 * Lock BEFORE any decision read (M3): the receta row `FOR UPDATE`, then a
 * fresh read. A concurrent `preparaciones.iniciar` on one of its ítems
 * either committed first (and is seen here as INICIADA) or waits for this
 * lock and then takes the receta again itself
 * (application/iniciar-preparacion.ts) -- so a receta with a preparación
 * INICIADA is never left untaken.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { validarCancelarToma } from "../domain/toma";
import { clearTomaDeReceta, getAvanceItemsDeReceta, getTomaDeReceta, lockRecetaParaTransicion } from "../infrastructure/preparacion-repository";

const cancelarTomaInput = z.object({ recetaId: uuid });

export interface CancelarTomaInput {
  recetaId: string;
}

export const cancelarTomaCommand = defineCommand({
  name: "preparaciones.cancelarToma",
  permiso: "preparaciones.iniciar",
  input: cancelarTomaInput,
  audit: { entidad: "receta", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaTransicion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getTomaDeReceta(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");
    const items = await getAvanceItemsDeReceta(tx, session.tenantId, input.recetaId);

    validarCancelarToma({ numeroInterno: receta.numeroInterno, tomadaPorId: receta.tomadaPorId, items });

    await clearTomaDeReceta(tx, session.tenantId, input.recetaId);

    return {
      output: { id: input.recetaId },
      audit: {
        entidadId: input.recetaId,
        valorAnterior: {
          receta: `Receta Nº ${receta.numeroInterno}`,
          tomadaPor: receta.tomadaPorNombre,
          tomadaEn: receta.tomadaEn ? receta.tomadaEn.toISOString() : null,
        },
        valorNuevo: { tomadaPor: null, tomadaEn: null },
      },
    };
  },
});

export async function cancelarToma(input: CancelarTomaInput): Promise<{ id: string }> {
  return cancelarTomaCommand.execute(input);
}
