/**
 * `tomarReceta` (M11, /preparaciones design "B"): the lab takes a receta
 * from the Pendientes queue. Only records WHO took it and WHEN
 * (`receta.tomada_por_id` / `tomada_en`, migration 0056) -- no preparación
 * is created and the receta's estado does not change, so a
 * PENDIENTE_PREPARACION receta stays editable. Rules: domain/toma.ts.
 *
 * Lock BEFORE any decision read (M3): the receta row `FOR UPDATE`, then a
 * fresh read of its toma and of where each ítem stands -- of two users
 * taking the same receta at once, the second waits for the lock and is
 * refused with who took it. Audited as a MODIFICAR of the receta.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { formatFechaHora } from "@/shared/format/fecha";
import { validarTomarReceta } from "../domain/toma";
import { getAvanceItemsDeReceta, getTomaDeReceta, lockRecetaParaTransicion, setTomaDeReceta } from "../infrastructure/preparacion-repository";

const tomarRecetaInput = z.object({ recetaId: uuid });

export interface TomarRecetaInput {
  recetaId: string;
}

export const tomarRecetaCommand = defineCommand({
  name: "preparaciones.tomarReceta",
  permiso: "preparaciones.iniciar",
  input: tomarRecetaInput,
  audit: { entidad: "receta", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaTransicion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getTomaDeReceta(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");
    const items = await getAvanceItemsDeReceta(tx, session.tenantId, input.recetaId);

    validarTomarReceta(
      {
        numeroInterno: receta.numeroInterno,
        estado: receta.estado,
        tomadaPorId: receta.tomadaPorId,
        tomadaPorNombre: receta.tomadaPorNombre,
        tomadaEnTexto: receta.tomadaEn ? formatFechaHora(receta.tomadaEn, receta.zonaHoraria) : null,
        items,
      },
      session.usuario.id,
    );

    const tomadaEn = await setTomaDeReceta(tx, session.tenantId, input.recetaId, session.usuario.id);

    return {
      output: { id: input.recetaId },
      audit: {
        entidadId: input.recetaId,
        valorAnterior: { tomadaPor: null, tomadaEn: null },
        valorNuevo: {
          receta: `Receta Nº ${receta.numeroInterno}`,
          tomadaPor: `${session.usuario.apellido}, ${session.usuario.nombre}`,
          tomadaEn: tomadaEn.toISOString(),
        },
      },
    };
  },
});

export async function tomarReceta(input: TomarRecetaInput): Promise<{ id: string }> {
  return tomarRecetaCommand.execute(input);
}
