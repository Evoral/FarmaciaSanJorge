/**
 * `reactivarDroga` (M06, FASE 4 point 4.2, INV-G01). Mirror of
 * `dar-de-baja-droga.ts`: clears `fecha_baja`/`motivo_baja`. Unlike unidades
 * (FASE 4 point 4.1), plan §7's matrix DOES define a dedicated
 * `drogas.reactivar` permiso (seeded in migration 0002, granted to FAR/DT/ADM
 * same as the other droga actions) -- used directly here, no reuse needed.
 * Same M3 lock-then-fresh-read fix as dar-de-baja-droga.ts -- see that
 * file's doc comment.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaDroga, getDrogaParaAccion, lockDrogaParaAccion } from "../infrastructure/droga-repository";

const reactivarDrogaInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type ReactivarDrogaInput = z.infer<typeof reactivarDrogaInput>;

export const reactivarDrogaCommand = defineCommand({
  name: "drogas.reactivar",
  permiso: "drogas.reactivar",
  input: reactivarDrogaInput,
  audit: { entidad: "droga", accion: "REACTIVAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockDrogaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Droga no encontrada.");

    const actual = await getDrogaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Droga no encontrada.");
    if (actual.fechaBaja === null) {
      throw new DomainError("Esta droga no está dada de baja.");
    }

    await cambiarBajaDroga(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: null, motivoBaja: null });

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        motivo: input.motivo,
        valorAnterior: { fechaBaja: actual.fechaBaja.toISOString(), motivoBaja: actual.motivoBaja },
        valorNuevo: { fechaBaja: null, motivoBaja: null },
      },
    };
  },
});

export async function reactivarDroga(input: ReactivarDrogaInput): Promise<{ id: string }> {
  return reactivarDrogaCommand.execute(input);
}
