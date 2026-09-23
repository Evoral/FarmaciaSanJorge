/**
 * `registrarRecepcionFisica` (M09, FASE 6 point 6.4). ATP/FAR/DT share
 * `recetas.fisica.registrar` (migration 0002's seed). INV-R09: this does
 * NOT block preparation (there is no estado gate here beyond "not already
 * registered") -- only ENTREGADA needs it, and that is INV-R07, already a
 * DB CHECK (migration 0011) this command never duplicates. Lock BEFORE the
 * fresh read (M3 discipline).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getRecetaParaAccion, lockRecetaParaAccion, registrarRecepcionFisica as registrarRecepcionFisicaRepo } from "../infrastructure/receta-repository";

const registrarRecepcionFisicaInput = z.object({ id: uuid });

export type RegistrarRecepcionFisicaInput = z.infer<typeof registrarRecepcionFisicaInput>;

export const registrarRecepcionFisicaCommand = defineCommand({
  name: "recetas.fisica.registrar",
  permiso: "recetas.fisica.registrar",
  input: registrarRecepcionFisicaInput,
  audit: { entidad: "receta", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const actual = await getRecetaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Receta no encontrada.");

    if (actual.recetaFisicaRecibida) {
      throw new DomainError("La recepción física de esta receta ya fue registrada.");
    }

    await registrarRecepcionFisicaRepo(tx, session.tenantId, input.id, session.usuario.id);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { recetaFisicaRecibida: false },
        valorNuevo: { recetaFisicaRecibida: true, recetaFisicaRecibidaPorId: session.usuario.id },
      },
    };
  },
});

export async function registrarRecepcionFisica(input: RegistrarRecepcionFisicaInput): Promise<{ id: string }> {
  return registrarRecepcionFisicaCommand.execute(input);
}
