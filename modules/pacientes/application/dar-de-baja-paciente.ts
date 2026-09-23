/**
 * `darDeBajaPaciente` (M06, FASE 4 point 4.5, INV-G01). Sets `fecha_baja` +
 * `motivo_baja` (migration 0029) -- never deleted (forbid_delete trigger,
 * migration 0007). Locks the target row FIRST (`lockPacienteParaAccion`)
 * and reads its current state with a FRESH statement only afterward -- see
 * `modules/proveedores/application/dar-de-baja-proveedor.ts`'s doc comment
 * for the concurrent-double-baja race this closes.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaPaciente, getPacienteParaAccion, lockPacienteParaAccion } from "../infrastructure/paciente-repository";

const darDeBajaPacienteInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type DarDeBajaPacienteInput = z.infer<typeof darDeBajaPacienteInput>;

export const darDeBajaPacienteCommand = defineCommand({
  name: "pacientes.baja",
  permiso: "pacientes.gestionar",
  input: darDeBajaPacienteInput,
  audit: { entidad: "paciente", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockPacienteParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Paciente no encontrado.");

    const actual = await getPacienteParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Paciente no encontrado.");
    if (actual.fechaBaja !== null) {
      throw new DomainError("Este paciente ya está dado de baja.");
    }

    const now = new Date();
    await cambiarBajaPaciente(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: now, motivoBaja: input.motivo });

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

export async function darDeBajaPaciente(input: DarDeBajaPacienteInput): Promise<{ id: string }> {
  return darDeBajaPacienteCommand.execute(input);
}
