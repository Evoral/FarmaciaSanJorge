/**
 * `quitarSinonimo` (docs/specs/sinonimos-droga.md): removes one of a
 * droga's other names. Soft delete (`fecha_baja`), never a DELETE, and
 * final (INV-DRG-003): to use the name again, add it again -- to this droga
 * or another one. Same permiso as editing the droga. Removing a synonym
 * never touches recetas, partidas or the libro: they all reference the
 * droga, whose canonical name they snapshot.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getSinonimoParaAccion, quitarSinonimo as quitarSinonimoRepo } from "../infrastructure/sinonimo-repository";

const quitarSinonimoInput = z.object({ id: uuid });

export type QuitarSinonimoInput = z.infer<typeof quitarSinonimoInput>;

const YA_QUITADO = "Ese nombre ya no figura en la droga: recargá la página.";

export const quitarSinonimoCommand = defineCommand({
  name: "drogas.sinonimos.quitar",
  permiso: "drogas.editar",
  input: quitarSinonimoInput,
  audit: { entidad: "droga_alias", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    const actual = await getSinonimoParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Sinónimo no encontrado.");
    if (actual.fechaBaja !== null) throw new ConflictError(YA_QUITADO);

    const now = new Date();
    if (!(await quitarSinonimoRepo(tx, session.tenantId, input.id, now))) throw new ConflictError(YA_QUITADO);

    return {
      output: { id: input.id, drogaId: actual.drogaId },
      audit: {
        entidadId: input.id,
        // The removed name and its droga only on the "antes" side, so the audit diff reads "Sinónimo: petrolato -> —".
        valorAnterior: { sinonimo: actual.texto, drogaId: actual.drogaId, droga: actual.drogaNombre, fechaBaja: null },
        valorNuevo: { fechaBaja: now.toISOString() },
      },
    };
  },
});

export async function quitarSinonimo(input: QuitarSinonimoInput): Promise<{ id: string; drogaId: string }> {
  return quitarSinonimoCommand.execute(input);
}
