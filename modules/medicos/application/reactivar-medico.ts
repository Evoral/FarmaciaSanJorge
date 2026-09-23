/**
 * `reactivarMedico` (M06, FASE 4 point 4.4, INV-G01). Mirror of
 * `dar-de-baja-medico.ts`: clears `fecha_baja`/`motivo_baja`. Same
 * lock-then-fresh-read pattern -- see that file's doc comment. Re-checks
 * matrícula uniqueness among vigentes: reactivating could otherwise collide
 * with another médico that took the same matrícula while this one was de
 * baja (migration 0007's partial unique index only excludes THIS row while
 * it is baja, not once it becomes vigente again).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaMedico, existeMatriculaVigente, getMedicoParaAccion, lockMedicoParaAccion } from "../infrastructure/medico-repository";

const reactivarMedicoInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type ReactivarMedicoInput = z.infer<typeof reactivarMedicoInput>;

export const reactivarMedicoCommand = defineCommand({
  name: "medicos.reactivar",
  permiso: "medicos.gestionar",
  input: reactivarMedicoInput,
  audit: { entidad: "medico", accion: "REACTIVAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockMedicoParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Médico no encontrado.");

    const actual = await getMedicoParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Médico no encontrado.");
    if (actual.fechaBaja === null) {
      throw new DomainError("Este médico no está dado de baja.");
    }

    if (await existeMatriculaVigente(tx, session.tenantId, actual.matricula, input.id)) {
      throw new ValidationError("Ya existe otro médico vigente con esa matrícula -- no se puede reactivar.");
    }

    await cambiarBajaMedico(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: null, motivoBaja: null });

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

export async function reactivarMedico(input: ReactivarMedicoInput): Promise<{ id: string }> {
  return reactivarMedicoCommand.execute(input);
}
