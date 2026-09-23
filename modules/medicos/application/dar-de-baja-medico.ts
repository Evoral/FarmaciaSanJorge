/**
 * `darDeBajaMedico` (M06, FASE 4 point 4.4). Sets `fecha_baja` +
 * `motivo_baja` (migration 0029) -- never deleted (forbid_delete trigger,
 * migration 0007). Locks the target row FIRST (`lockMedicoParaAccion`) and
 * reads its current state with a FRESH statement only afterward -- see
 * `dar-de-baja-proveedor.ts`'s doc comment for the concurrent-double-baja
 * race this closes.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaMedico, getMedicoParaAccion, lockMedicoParaAccion } from "../infrastructure/medico-repository";

const darDeBajaMedicoInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type DarDeBajaMedicoInput = z.infer<typeof darDeBajaMedicoInput>;

export const darDeBajaMedicoCommand = defineCommand({
  name: "medicos.baja",
  permiso: "medicos.gestionar",
  input: darDeBajaMedicoInput,
  audit: { entidad: "medico", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockMedicoParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Médico no encontrado.");

    const actual = await getMedicoParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Médico no encontrado.");
    if (actual.fechaBaja !== null) {
      throw new DomainError("Este médico ya está dado de baja.");
    }

    const now = new Date();
    await cambiarBajaMedico(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: now, motivoBaja: input.motivo });

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

export async function darDeBajaMedico(input: DarDeBajaMedicoInput): Promise<{ id: string }> {
  return darDeBajaMedicoCommand.execute(input);
}
