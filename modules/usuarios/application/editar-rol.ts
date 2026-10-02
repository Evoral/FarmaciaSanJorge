/**
 * `editarRol` (DP-03 RESUELTA 2026-10-01): changes nombre, descripción and
 * permisos of a role of the session's tenant. `codigo` never changes
 * (INV-ROL-001).
 *
 * Rules (modules/usuarios/domain/roles.ts, also DB-enforced where noted):
 *   - ADMINISTRADOR (locked: consulta/gestion, no operativo) and SISTEMA cannot be edited
 *     (INV-ROL-002); SISTEMA is reported as not found (it is never shown).
 *   - The actor cannot edit a role they hold.
 *   - Escalation: the actor cannot add a permiso outside their grantable
 *     set (held permisos, plus every operativo one for an ADMINISTRADOR);
 *     permisos of the role outside that set are kept untouched
 *     (`otorgablesDelActor` / `resolverPermisosDeRol`).
 *
 * The role row is locked first (`lockRol`), so a concurrent edit/delete of
 * the same role waits and then reads the committed state -- keeps the
 * escalation check and the audit `valorAnterior` truthful. Requires a recent
 * re-authentication. Audited as EDITAR_ROL (before/after: nombre,
 * descripción, sorted permisos). Takes effect on the next request of every
 * usuario holding the role (permisos are re-read per request, see
 * modules/auth/infrastructure/session-repository.ts).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { motivoNoEditable, motivoNoGestionable, resolverPermisosDeRol, ROL_SISTEMA } from "../domain/roles";
import {
  existeNombreDeRol,
  findRolById,
  lockRol,
  reemplazarPermisosDeRol,
  updateDatosDeRol,
} from "../infrastructure/rol-repository";
import { datosDeRolInput, snapshotDeRol } from "./rol-input";
import { otorgablesDelActor } from "./roles-asignables";

const editarRolInput = z.object({ rolId: uuid, ...datosDeRolInput });

export type EditarRolInput = z.input<typeof editarRolInput>;

export const editarRolCommand = defineCommand({
  name: "roles.editar",
  permiso: "roles.gestionar",
  input: editarRolInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "rol", accion: TipoAccion.EDITAR_ROL },
  handler: async ({ tx, session, input }) => {
    if (!(await lockRol(tx, session.tenantId, input.rolId))) throw new NotFoundError("Rol no encontrado.");
    const actual = await findRolById(tx, session.tenantId, input.rolId);
    if (!actual || actual.codigo === ROL_SISTEMA) throw new NotFoundError("Rol no encontrado.");

    const noEditable = motivoNoEditable(actual);
    if (noEditable) throw new DomainError(noEditable);

    const { rolesDelActor, otorgables } = await otorgablesDelActor(tx, session);
    const noGestionable = motivoNoGestionable(actual.codigo, rolesDelActor);
    if (noGestionable) throw new DomainError(noGestionable);

    if (
      input.nombre.toLowerCase() !== actual.nombre.toLowerCase() &&
      (await existeNombreDeRol(tx, session.tenantId, input.nombre, actual.id))
    ) {
      throw new ValidationError("Ya existe un rol con ese nombre.", { fields: ["nombre"] });
    }

    const resolucion = resolverPermisosDeRol({ solicitados: input.permisos, actuales: actual.permisos, otorgables });
    if (!resolucion.ok) {
      throw new DomainError(`No podés otorgar estos permisos: ${resolucion.noOtorgables.join(", ")}.`, { fields: ["permisos"] });
    }

    const antes = snapshotDeRol(actual);
    const despues = snapshotDeRol({ codigo: actual.codigo, nombre: input.nombre, descripcion: input.descripcion, permisos: resolucion.permisos });
    if (JSON.stringify(antes) === JSON.stringify(despues)) {
      throw new DomainError("No hay cambios para guardar.");
    }

    await updateDatosDeRol(tx, session.tenantId, actual.id, { nombre: input.nombre, descripcion: input.descripcion });
    await reemplazarPermisosDeRol(tx, session.tenantId, actual.id, resolucion.permisos);

    return {
      output: { rolId: actual.id },
      audit: { entidadId: actual.id, valorAnterior: antes, valorNuevo: despues },
    };
  },
});

export async function editarRol(input: EditarRolInput): Promise<{ rolId: string }> {
  return editarRolCommand.execute(input);
}
