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
 *
 * A cuenta de sector (openspec/specs/cuentas-de-sector/spec.md) is edited the
 * way it is created: only its name (sent as `nombre`) and email. apellido and
 * DNI are derived again from the name (`../domain/cuenta-de-sector.ts`) and it
 * has no matrícula, so the submitted apellido/dni/numeroMatricula are ignored.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { email as emailSchema, nonEmptyString, uuid } from "@/shared/validation";
import { identidadDeCuentaDeSector } from "../domain/cuenta-de-sector";
import { loadUsuarioParaAccion, existeEmail, existeDni, updateUsuarioDatosPersonales } from "../infrastructure/usuario-repository";

const editarUsuarioInput = z.object({
  id: uuid,
  nombre: nonEmptyString,
  /** Required for a person; ignored for a cuenta de sector (derived from `nombre`). */
  apellido: z.string().trim().default(""),
  email: emailSchema,
  /** Required for a person; ignored for a cuenta de sector (derived from `nombre`). */
  dni: z.string().trim().default(""),
  numeroMatricula: z.string().trim().max(100).optional(),
  version: z.object({
    nombre: z.string(),
    apellido: z.string(),
    email: z.string(),
    dni: z.string(),
    numeroMatricula: z.string().nullable(),
  }),
});

/** Pre-default wire shape: a cuenta de sector may omit `apellido` and `dni`. */
export type EditarUsuarioInput = z.input<typeof editarUsuarioInput>;

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

    const identidad = actual.esSector ? identidadDeCuentaDeSector(input.nombre) : { nombre: input.nombre, apellido: input.apellido, dni: input.dni };
    if (!identidad) {
      throw new ValidationError("El nombre del sector debe tener al menos una letra o un número.", { fields: ["nombre"] });
    }
    if (!actual.esSector) {
      const vacios = (["apellido", "dni"] as const).filter((campo) => !identidad[campo]);
      if (vacios.length > 0) throw new ValidationError("Este campo no puede estar vacío.", { fields: [...vacios] });
    }

    if (input.email !== actual.email && (await existeEmail(tx, input.email, input.id))) {
      throw new ValidationError("Ya existe un usuario con ese email.", { fields: ["email"] });
    }
    if (identidad.dni !== actual.dni && (await existeDni(tx, session.tenantId, identidad.dni, input.id))) {
      throw new ValidationError(actual.esSector ? "Ya existe una cuenta de sector con ese nombre." : "Ya existe un usuario con ese DNI en esta farmacia.", {
        fields: [actual.esSector ? "nombre" : "dni"],
      });
    }

    const numeroMatriculaNuevo = actual.esSector ? null : (input.numeroMatricula ?? null);
    const updated = await updateUsuarioDatosPersonales(
      tx,
      { id: input.id, nombre: identidad.nombre, apellido: identidad.apellido, email: input.email, dni: identidad.dni, numeroMatricula: numeroMatriculaNuevo },
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
        valorNuevo: { nombre: identidad.nombre, apellido: identidad.apellido, email: input.email, dni: identidad.dni, numeroMatricula: numeroMatriculaNuevo },
      },
    };
  },
});

export async function editarUsuario(input: EditarUsuarioInput): Promise<{ id: string }> {
  return editarUsuarioCommand.execute(input);
}
