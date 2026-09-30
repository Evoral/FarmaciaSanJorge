/**
 * `editarMedico` (M06, FASE 4 point 4.4). Optimistic concurrency
 * (compare-and-swap) PLUS a row lock taken BEFORE the state is read --
 * same pattern as modules/proveedores/application/editar-proveedor.ts:
 * `lockMedicoParaAccion` first, then a FRESH read (`getMedicoParaAccion`),
 * so a concurrent baja/reactivación/edit on the SAME médico serializes
 * against this one, and a médico given de baja while this edit was in
 * flight is correctly detected as a conflict instead of silently
 * overwritten.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { JURISDICCIONES_MATRICULA, jurisdiccionMatricula, matriculaString } from "../domain/medico";
import { existeMatriculaVigente, getMedicoParaAccion, lockMedicoParaAccion, updateMedicoDatos } from "../infrastructure/medico-repository";

const optionalField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const editarMedicoInput = z.object({
  id: uuid,
  nombre: nonEmptyString,
  apellido: nonEmptyString,
  matricula: matriculaString,
  matriculaJurisdiccion: jurisdiccionMatricula,
  especialidad: optionalField,
  telefono: optionalField,
  direccionRegistrada: optionalField,
  version: z.object({
    nombre: z.string(),
    apellido: z.string(),
    matricula: z.string(),
    matriculaJurisdiccion: z.enum(JURISDICCIONES_MATRICULA),
    especialidad: z.string().nullable(),
    telefono: z.string().nullable(),
    direccionRegistrada: z.string().nullable(),
  }),
});

export type EditarMedicoInput = z.infer<typeof editarMedicoInput>;
/** Pre-transform wire shape -- see crear-medico.ts's `CrearMedicoWireInput` doc comment. */
export type EditarMedicoWireInput = z.input<typeof editarMedicoInput>;

export const CONCURRENCY_MESSAGE = "El médico fue modificado por otra persona, recargá.";

export const editarMedicoCommand = defineCommand({
  name: "medicos.editar",
  permiso: "medicos.gestionar",
  input: editarMedicoInput,
  audit: { entidad: "medico", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockMedicoParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Médico no encontrado.");

    const actual = await getMedicoParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Médico no encontrado.");

    if (actual.fechaBaja !== null) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (
      actual.nombre !== input.version.nombre ||
      actual.apellido !== input.version.apellido ||
      actual.matricula !== input.version.matricula ||
      actual.matriculaJurisdiccion !== input.version.matriculaJurisdiccion ||
      actual.especialidad !== input.version.especialidad ||
      actual.telefono !== input.version.telefono ||
      actual.direccionRegistrada !== input.version.direccionRegistrada
    ) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    const cambiaMatricula = input.matricula !== actual.matricula || input.matriculaJurisdiccion !== actual.matriculaJurisdiccion;
    if (cambiaMatricula && (await existeMatriculaVigente(tx, session.tenantId, input.matriculaJurisdiccion, input.matricula, input.id))) {
      throw new ValidationError("Ya existe un médico vigente con esa matrícula en esa jurisdicción.");
    }

    const nuevoValor = {
      nombre: input.nombre,
      apellido: input.apellido,
      matricula: input.matricula,
      matriculaJurisdiccion: input.matriculaJurisdiccion,
      especialidad: input.especialidad,
      telefono: input.telefono,
      direccionRegistrada: input.direccionRegistrada,
    };
    const valorAnterior = {
      nombre: actual.nombre,
      apellido: actual.apellido,
      matricula: actual.matricula,
      matriculaJurisdiccion: actual.matriculaJurisdiccion,
      especialidad: actual.especialidad,
      telefono: actual.telefono,
      direccionRegistrada: actual.direccionRegistrada,
    };

    const updated = await updateMedicoDatos(tx, session.tenantId, { id: input.id, ...nuevoValor }, valorAnterior);
    if (!updated) throw new ConflictError(CONCURRENCY_MESSAGE);

    return {
      output: { id: input.id },
      audit: { entidadId: input.id, valorAnterior, valorNuevo: nuevoValor },
    };
  },
});

export async function editarMedico(input: EditarMedicoWireInput): Promise<{ id: string }> {
  return editarMedicoCommand.execute(input);
}
