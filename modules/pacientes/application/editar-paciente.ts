/**
 * `editarPaciente` (M06, FASE 4 point 4.5). Optimistic concurrency
 * (compare-and-swap) PLUS a row lock taken BEFORE the state is read --
 * same pattern as modules/proveedores/application/editar-proveedor.ts:
 * `lockPacienteParaAccion` first, then a FRESH read
 * (`getPacienteParaAccion`), so a concurrent baja/reactivación/edit on the
 * SAME paciente serializes against this one, and a paciente given de baja
 * while this edit was in flight is correctly detected as a conflict.
 * HEALTH-ADJACENT DATA (DP-24): see crear-paciente.ts's doc comment.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cuilOpcional, dniOpcional } from "../domain/paciente";
import { existeCuil, getPacienteParaAccion, lockPacienteParaAccion, updatePacienteDatos } from "../infrastructure/paciente-repository";
import type { PacienteParaAccion } from "../infrastructure/paciente-repository";

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

const editarPacienteInput = z.object({
  id: uuid,
  nombre: nonEmptyString,
  apellido: nonEmptyString,
  cuil: cuilOpcional,
  dni: dniOpcional,
  telefono: textoOpcional,
  email: textoOpcional,
  fechaNacimiento: fechaOpcional,
  nroCredencial: textoOpcional,
  sexo: textoOpcional,
  version: z.object({
    nombre: z.string(),
    apellido: z.string(),
    cuil: z.string().nullable(),
    dni: z.string().nullable(),
    telefono: z.string().nullable(),
    email: z.string().nullable(),
    fechaNacimiento: z.string().nullable(),
    nroCredencial: z.string().nullable(),
    sexo: z.string().nullable(),
  }),
});

export type EditarPacienteInput = z.infer<typeof editarPacienteInput>;
/** Pre-transform wire shape -- see crear-paciente.ts's `CrearPacienteWireInput` doc comment. */
export type EditarPacienteWireInput = z.input<typeof editarPacienteInput>;

export const CONCURRENCY_MESSAGE = "El paciente fue modificado por otra persona, recargá.";

/** `fecha_nacimiento` is a DB `date` (no time component) -- compare/serialize as its `YYYY-MM-DD` slice, not full ISO-with-time, so a round trip through the DB never spuriously looks "changed". */
function fechaToISODate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function versionMatches(actual: PacienteParaAccion, version: EditarPacienteInput["version"]): boolean {
  return (
    actual.nombre === version.nombre &&
    actual.apellido === version.apellido &&
    actual.cuil === version.cuil &&
    actual.dni === version.dni &&
    actual.telefono === version.telefono &&
    actual.email === version.email &&
    fechaToISODate(actual.fechaNacimiento) === version.fechaNacimiento &&
    actual.nroCredencial === version.nroCredencial &&
    actual.sexo === version.sexo
  );
}

export const editarPacienteCommand = defineCommand({
  name: "pacientes.editar",
  permiso: "pacientes.gestionar",
  input: editarPacienteInput,
  audit: { entidad: "paciente", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockPacienteParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Paciente no encontrado.");

    const actual = await getPacienteParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Paciente no encontrado.");

    if (actual.fechaBaja !== null) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (!versionMatches(actual, input.version)) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (input.cuil && input.cuil !== actual.cuil && (await existeCuil(tx, session.tenantId, input.cuil, input.id))) {
      throw new ValidationError("Ya existe un paciente con ese CUIL.");
    }

    const nuevoValor = {
      nombre: input.nombre,
      apellido: input.apellido,
      cuil: input.cuil,
      dni: input.dni,
      telefono: input.telefono,
      email: input.email,
      fechaNacimiento: input.fechaNacimiento,
      nroCredencial: input.nroCredencial,
      sexo: input.sexo,
    };
    const valorAnterior = {
      nombre: actual.nombre,
      apellido: actual.apellido,
      cuil: actual.cuil,
      dni: actual.dni,
      telefono: actual.telefono,
      email: actual.email,
      fechaNacimiento: actual.fechaNacimiento,
      nroCredencial: actual.nroCredencial,
      sexo: actual.sexo,
    };

    const updated = await updatePacienteDatos(tx, session.tenantId, { id: input.id, ...nuevoValor }, valorAnterior);
    if (!updated) throw new ConflictError(CONCURRENCY_MESSAGE);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { ...valorAnterior, fechaNacimiento: fechaToISODate(valorAnterior.fechaNacimiento) },
        valorNuevo: { ...nuevoValor, fechaNacimiento: fechaToISODate(nuevoValor.fechaNacimiento) },
      },
    };
  },
});

export async function editarPaciente(input: EditarPacienteWireInput): Promise<{ id: string }> {
  return editarPacienteCommand.execute(input);
}
