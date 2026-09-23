/**
 * `crearPaciente` (M06, FASE 4 point 4.5). ATP/FAR/DT share ONE permiso,
 * `pacientes.gestionar` (plan §7: "pacientes.*"). HEALTH-ADJACENT DATA
 * (DP-24): this handler's `audit` write is the ONLY place paciente fields
 * are ever persisted outside `fsj.paciente` itself -- `fsj.registro_auditoria`
 * is access-restricted to `auditoria.ver` (ADM, DT). Nothing here is ever
 * passed to a logger.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ValidationError } from "@/shared/errors";
import { nonEmptyString } from "@/shared/validation";
import { cuilOpcional, dniOpcional } from "../domain/paciente";
import { existeCuil, insertPaciente } from "../infrastructure/paciente-repository";

const textoOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const fechaOpcional = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value || value.length === 0) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Fecha de nacimiento inválida." });
      return z.NEVER;
    }
    return date;
  });

const crearPacienteInput = z.object({
  nombre: nonEmptyString,
  apellido: nonEmptyString,
  cuil: cuilOpcional,
  dni: dniOpcional,
  telefono: textoOpcional,
  email: textoOpcional,
  fechaNacimiento: fechaOpcional,
  nroCredencial: textoOpcional,
  sexo: textoOpcional,
});

export type CrearPacienteInput = z.infer<typeof crearPacienteInput>;
/** Pre-transform wire shape (what a Server Action hands in from raw `FormData` -- everything as `string | undefined`, not yet normalized/validated) -- see modules/auditoria/application/list-registro-auditoria.ts's `WireInput` convention. */
export type CrearPacienteWireInput = z.input<typeof crearPacienteInput>;

export const crearPacienteCommand = defineCommand({
  name: "pacientes.crear",
  permiso: "pacientes.gestionar",
  input: crearPacienteInput,
  audit: { entidad: "paciente", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    if (input.cuil && (await existeCuil(tx, session.tenantId, input.cuil))) {
      throw new ValidationError("Ya existe un paciente con ese CUIL.");
    }

    const nuevo = await insertPaciente(tx, {
      tenantId: session.tenantId,
      nombre: input.nombre,
      apellido: input.apellido,
      cuil: input.cuil,
      dni: input.dni,
      telefono: input.telefono,
      email: input.email,
      fechaNacimiento: input.fechaNacimiento,
      nroCredencial: input.nroCredencial,
      sexo: input.sexo,
    });

    return {
      output: { id: nuevo.id },
      audit: {
        entidadId: nuevo.id,
        valorNuevo: {
          nombre: input.nombre,
          apellido: input.apellido,
          cuil: input.cuil,
          dni: input.dni,
          telefono: input.telefono,
          email: input.email,
          fechaNacimiento: input.fechaNacimiento ? input.fechaNacimiento.toISOString() : null,
          nroCredencial: input.nroCredencial,
          sexo: input.sexo,
        },
      },
    };
  },
});

export async function crearPaciente(input: CrearPacienteWireInput): Promise<{ id: string }> {
  return crearPacienteCommand.execute(input);
}
