/**
 * `crearMedico` (M06, FASE 4 point 4.4). ATP/FAR/DT share ONE permiso,
 * `medicos.gestionar` (plan §7: "medicos.*"), for every action in this
 * module -- migration 0002's seed grants it identically to crear, editar,
 * baja and reactivar. The receta flow's quick-create is a separate command
 * with this same input and handler but `recetas.crear` as its permiso
 * (crear-medico-desde-receta.ts).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { CommandHandlerArgs, CommandHandlerResult } from "@/shared/usecase";
import { ValidationError } from "@/shared/errors";
import { nonEmptyString } from "@/shared/validation";
import { jurisdiccionMatricula, matriculaString } from "../domain/medico";
import { existeMatriculaVigente, insertMedico } from "../infrastructure/medico-repository";

export const crearMedicoInput = z.object({
  nombre: nonEmptyString,
  apellido: nonEmptyString,
  matricula: matriculaString,
  matriculaJurisdiccion: jurisdiccionMatricula,
  especialidad: z.string().trim().optional().transform((v) => (v && v.length > 0 ? v : null)),
  telefono: z.string().trim().optional().transform((v) => (v && v.length > 0 ? v : null)),
  direccionRegistrada: z.string().trim().optional().transform((v) => (v && v.length > 0 ? v : null)),
});

export type CrearMedicoInput = z.infer<typeof crearMedicoInput>;
/** Pre-transform wire shape (what a Server Action hands in from raw `FormData` -- optional fields as `string | undefined`, not yet normalized to `string | null`) -- see modules/auditoria/application/list-registro-auditoria.ts's `WireInput` convention for why this is a separate type from `CrearMedicoInput` above. */
export type CrearMedicoWireInput = z.input<typeof crearMedicoInput>;

/** Shared by `medicos.crear` and the receta flow's `medicos.crear-desde-receta` -- only the permiso differs. */
export async function crearMedicoHandler({ tx, session, input }: CommandHandlerArgs<CrearMedicoInput>): Promise<CommandHandlerResult<{ id: string }>> {
  if (await existeMatriculaVigente(tx, session.tenantId, input.matriculaJurisdiccion, input.matricula)) {
    throw new ValidationError("Ya existe un médico vigente con esa matrícula en esa jurisdicción.");
  }

  const nuevo = await insertMedico(tx, {
    tenantId: session.tenantId,
    nombre: input.nombre,
    apellido: input.apellido,
    matricula: input.matricula,
    matriculaJurisdiccion: input.matriculaJurisdiccion,
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
        matriculaJurisdiccion: input.matriculaJurisdiccion,
        especialidad: input.especialidad,
        telefono: input.telefono,
        direccionRegistrada: input.direccionRegistrada,
      },
    },
  };
}

export const crearMedicoCommand = defineCommand({
  name: "medicos.crear",
  permiso: "medicos.gestionar",
  input: crearMedicoInput,
  audit: { entidad: "medico", accion: TipoAccion.CREAR },
  handler: crearMedicoHandler,
});

export async function crearMedico(input: CrearMedicoWireInput): Promise<{ id: string }> {
  return crearMedicoCommand.execute(input);
}
