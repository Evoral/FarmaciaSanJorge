/**
 * `darDeBajaDroga` (M06, FASE 4 point 4.2, INV-G01). Sets `fecha_baja` +
 * `motivo_baja` -- never deleted (INV-F03). A droga already de baja cannot
 * be given de baja again.
 *
 * M3 (review finding): locks the target row FIRST (`lockDrogaParaAccion`)
 * and reads its current state with a FRESH statement only afterward -- see
 * modules/proveedores/application/dar-de-baja-proveedor.ts's doc comment
 * for the exact race this closes (same shape in every FASE 4 catalog).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaDroga, getDrogaParaAccion, lockDrogaParaAccion } from "../infrastructure/droga-repository";

const darDeBajaDrogaInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type DarDeBajaDrogaInput = z.infer<typeof darDeBajaDrogaInput>;

export const darDeBajaDrogaCommand = defineCommand({
  name: "drogas.baja",
  permiso: "drogas.baja",
  input: darDeBajaDrogaInput,
  audit: { entidad: "droga", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockDrogaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Droga no encontrada.");

    const actual = await getDrogaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Droga no encontrada.");
    if (actual.fechaBaja !== null) {
      throw new DomainError("Esta droga ya está dada de baja.");
    }

    const now = new Date();
    await cambiarBajaDroga(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: now, motivoBaja: input.motivo });

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        motivo: input.motivo,
        valorAnterior: { fechaBaja: null },
        valorNuevo: { fechaBaja: now.toISOString(), motivoBaja: input.motivo },
      },
    };
  },
});

export async function darDeBajaDroga(input: DarDeBajaDrogaInput): Promise<{ id: string }> {
  return darDeBajaDrogaCommand.execute(input);
}
