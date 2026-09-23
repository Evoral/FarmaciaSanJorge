/**
 * `crearMedico` (M06, FASE 4 point 4.4). ATP/FAR/DT share ONE permiso,
 * `medicos.gestionar` (plan §7: "medicos.*"), for every action in this
 * module -- migration 0002's seed grants it identically to crear, editar,
 * baja and reactivar.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ValidationError } from "@/shared/errors";
import { nonEmptyString } from "@/shared/validation";
import { matriculaString } from "../domain/medico";
import { existeMatriculaVigente, insertMedico } from "../infrastructure/medico-repository";

const crearMedicoInput = z.object({
  nombre: nonEmptyString,
  apellido: nonEmptyString,
  matricula: matriculaString,
  especialidad: z.string().trim().optional().transform((v) => (v && v.length > 0 ? v : null)),
  telefono: z.string().trim().optional().transform((v) => (v && v.length > 0 ? v : null)),
  direccionRegistrada: z.string().trim().optional().transform((v) => (v && v.length > 0 ? v : null)),
});

export type CrearMedicoInput = z.infer<typeof crearMedicoInput>;
/** Pre-transform wire shape (what a Server Action hands in from raw `FormData` -- optional fields as `string | undefined`, not yet normalized to `string | null`) -- see modules/auditoria/application/list-registro-auditoria.ts's `WireInput` convention for why this is a separate type from `CrearMedicoInput` above. */
export type CrearMedicoWireInput = z.input<typeof crearMedicoInput>;

export const crearMedicoCommand = defineCommand({
  name: "medicos.crear",
  permiso: "medicos.gestionar",
  input: crearMedicoInput,
  audit: { entidad: "medico", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    if (await existeMatriculaVigente(tx, session.tenantId, input.matricula)) {
      throw new ValidationError("Ya existe un médico vigente con esa matrícula.");
    }

    const nuevo = await insertMedico(tx, {
      tenantId: session.tenantId,
      nombre: input.nombre,
      apellido: input.apellido,
      matricula: input.matricula,
      especialidad: input.especialidad,
      telefono: input.telefono,
      direccionRegistrada: input.direccionRegistrada,
    });

    return {
      output: { id: nuevo.id },
      audit: {
        entidadId: nuevo.id,
        valorNuevo: {
          nombre: input.nombre,
          apellido: input.apellido,
          matricula: input.matricula,
          especialidad: input.especialidad,
          telefono: input.telefono,
          direccionRegistrada: input.direccionRegistrada,
        },
      },
    };
  },
});

export async function crearMedico(input: CrearMedicoWireInput): Promise<{ id: string }> {
  return crearMedicoCommand.execute(input);
}
