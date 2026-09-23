/**
 * `editarUsuario` (M03, FASE 3 point 3.3): edits personal data only (never
 * estado, never roles -- those are separate commands). Optimistic
 * concurrency: the caller must submit the exact field values the edit form
 * was loaded with (`version`) alongside the new values; if the row no
 * longer matches `version`, the update touches zero rows and this rejects
 * with the plan's exact message instead of silently overwriting a
 * concurrent edit. See
 * modules/usuarios/infrastructure/usuario-repository.ts#updateUsuarioDatosPersonales
 * for why this compare-and-swap approach is used instead of a dedicated
 * version/`actualizado_en` column (none exists on `fsj.usuario`, and this
 * task must not add a migration).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { email as emailSchema, nonEmptyString, uuid } from "@/shared/validation";
import { loadUsuarioParaAccion, existeEmail, existeDni, updateUsuarioDatosPersonales } from "../infrastructure/usuario-repository";

const editarUsuarioInput = z.object({
  id: uuid,
  nombre: nonEmptyString,
  apellido: nonEmptyString,
  email: emailSchema,
  dni: nonEmptyString,
  numeroMatricula: z.string().trim().max(100).optional(),
  version: z.object({
    nombre: z.string(),
    apellido: z.string(),
    email: z.string(),
    dni: z.string(),
    numeroMatricula: z.string().nullable(),
  }),
});

export type EditarUsuarioInput = z.infer<typeof editarUsuarioInput>;

export const CONCURRENCY_MESSAGE = "El usuario fue modificado por otra persona, recargá.";

export const editarUsuarioCommand = defineCommand({
  name: "usuarios.editar",
  permiso: "usuarios.editar",
  input: editarUsuarioInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const actual = await loadUsuarioParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    if (
      actual.nombre !== input.version.nombre ||
      actual.apellido !== input.version.apellido ||
      actual.email !== input.version.email ||
      actual.dni !== input.version.dni ||
      (actual.numeroMatricula ?? null) !== (input.version.numeroMatricula ?? null)
    ) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (input.email !== actual.email && (await existeEmail(tx, input.email, input.id))) {
      throw new ValidationError("Ya existe un usuario con ese email.");
    }
    if (input.dni !== actual.dni && (await existeDni(tx, session.tenantId, input.dni, input.id))) {
      throw new ValidationError("Ya existe un usuario con ese DNI en esta farmacia.");
    }

    const numeroMatriculaNuevo = input.numeroMatricula ?? null;
    const updated = await updateUsuarioDatosPersonales(
      tx,
      { id: input.id, nombre: input.nombre, apellido: input.apellido, email: input.email, dni: input.dni, numeroMatricula: numeroMatriculaNuevo },
      {
        nombre: actual.nombre,
        apellido: actual.apellido,
        email: actual.email,
        dni: actual.dni,
        numeroMatricula: actual.numeroMatricula,
      },
    );
    if (!updated) {
      // Lost a race between the check above and this UPDATE.
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { nombre: actual.nombre, apellido: actual.apellido, email: actual.email, dni: actual.dni, numeroMatricula: actual.numeroMatricula },
        valorNuevo: { nombre: input.nombre, apellido: input.apellido, email: input.email, dni: input.dni, numeroMatricula: numeroMatriculaNuevo },
      },
    };
  },
});

export async function editarUsuario(input: EditarUsuarioInput): Promise<{ id: string }> {
  return editarUsuarioCommand.execute(input);
}
