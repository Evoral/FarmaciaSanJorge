/**
 * `anularReceta` (M09, FASE 6 point 6.5). ONLY FAR/DT hold
 * `recetas.anular` (migration 0002's seed -- unlike crear/editar/fisica,
 * which ATP also holds). Per docs/specs/libro-recetario-y-contralor.md
 * section 1: annulment is allowed from any non-terminal estado (INV-R08,
 * enforced by the DB trigger, mirrored here for a clear message). If a
 * preparación was already confirmed for one of this receta's items, the
 * receta still becomes ANULADA but NOTHING reverts -- no stock movement,
 * no asiento correction. That correction is FASE 9's job
 * (docs/specs/libro-recetario-y-contralor.md section 1: "AnulacionAsiento"/
 * rectificativo). This command does not attempt it and the UI states this
 * plainly (modules/recetas/ui's anular form copy).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { puedeAnular } from "../domain/receta";
import { anularReceta as anularRecetaRepo, getRecetaParaAccion, lockRecetaParaAccion } from "../infrastructure/receta-repository";

const anularRecetaInput = z.object({ id: uuid, motivo: nonEmptyString });

export type AnularRecetaInput = z.infer<typeof anularRecetaInput>;

export const anularRecetaCommand = defineCommand({
  name: "recetas.anular",
  permiso: "recetas.anular",
  input: anularRecetaInput,
  audit: { entidad: "receta", accion: TipoAccion.ANULAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const actual = await getRecetaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Receta no encontrada.");

    if (!puedeAnular(actual.estado)) {
      throw new DomainError(`La receta no se puede anular: su estado (${actual.estado}) ya es terminal.`);
    }

    await anularRecetaRepo(tx, session.tenantId, input.id, input.motivo);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        motivo: input.motivo,
        valorAnterior: { estado: actual.estado },
        valorNuevo: { estado: "ANULADA" },
      },
    };
  },
});

export async function anularReceta(input: AnularRecetaInput): Promise<{ id: string }> {
  return anularRecetaCommand.execute(input);
}
