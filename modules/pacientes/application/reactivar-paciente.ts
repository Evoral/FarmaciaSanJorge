/**
 * `reactivarPaciente` (M06, FASE 4 point 4.5, INV-G01). Mirror of
 * `dar-de-baja-paciente.ts`: clears `fecha_baja`/`motivo_baja`. Same
 * lock-then-fresh-read pattern -- see that file's doc comment. Unlike
 * médico's matrícula, paciente's cuil uniqueness (migration 0007's
 * `uq_paciente_cuil`) is NOT scoped to vigente rows -- it already held
 * while this paciente was de baja, so no re-check is needed here.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaPaciente, getPacienteParaAccion, lockPacienteParaAccion } from "../infrastructure/paciente-repository";

const reactivarPacienteInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type ReactivarPacienteInput = z.infer<typeof reactivarPacienteInput>;

export const reactivarPacienteCommand = defineCommand({
  name: "pacientes.reactivar",
  permiso: "pacientes.gestionar",
  input: reactivarPacienteInput,
  audit: { entidad: "paciente", accion: "REACTIVAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockPacienteParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Paciente no encontrado.");

    const actual = await getPacienteParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Paciente no encontrado.");
    if (actual.fechaBaja === null) {
      throw new DomainError("Este paciente no está dado de baja.");
    }

    await cambiarBajaPaciente(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: null, motivoBaja: null });

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

export async function reactivarPaciente(input: ReactivarPacienteInput): Promise<{ id: string }> {
  return reactivarPacienteCommand.execute(input);
}
