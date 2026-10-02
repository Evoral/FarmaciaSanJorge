/**
 * `eliminarRol` (DP-03 RESUELTA 2026-10-01): deletes a role of the session's
 * tenant. Only roles with protection `NINGUNA` (the default
 * FARMACEUTICO / ATENCION_PUBLICO / SOLO_CONSULTA and custom roles) and
 * only while NO usuario holds it -- the error says how many do
 * (INV-ROL-004 / the composite FK from usuario_rol are the DB backstops).
 * ADMINISTRADOR / SISTEMA (INV-ROL-002) and DIRECTOR_TECNICO (INV-ROL-003)
 * are never deletable. The actor cannot delete a role they hold.
 *
 * Locks the role row first (same reason as editar-rol.ts). Requires a
 * recent re-authentication. Audited as ELIMINAR_ROL with the role's last
 * nombre, descripción and sorted permisos. Its rol_permiso rows go with it
 * (ON DELETE CASCADE).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { motivoNoEliminable, motivoNoGestionable, ROL_SISTEMA } from "../domain/roles";
import { codigosDeRolesDelUsuario, deleteRol, findRolById, lockRol } from "../infrastructure/rol-repository";
import { snapshotDeRol } from "./rol-input";

const eliminarRolInput = z.object({ rolId: uuid });

export type EliminarRolInput = z.infer<typeof eliminarRolInput>;

export const eliminarRolCommand = defineCommand({
  name: "roles.eliminar",
  permiso: "roles.gestionar",
  input: eliminarRolInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "rol", accion: TipoAccion.ELIMINAR_ROL },
  handler: async ({ tx, session, input }) => {
    if (!(await lockRol(tx, session.tenantId, input.rolId))) throw new NotFoundError("Rol no encontrado.");
    const actual = await findRolById(tx, session.tenantId, input.rolId);
    if (!actual || actual.codigo === ROL_SISTEMA) throw new NotFoundError("Rol no encontrado.");

    const noGestionable = motivoNoGestionable(actual.codigo, await codigosDeRolesDelUsuario(tx, session.tenantId, session.usuario.id));
    if (noGestionable) throw new DomainError(noGestionable);

    const noEliminable = motivoNoEliminable(actual, actual.cantidadUsuarios);
    if (noEliminable) throw new DomainError(noEliminable);

    await deleteRol(tx, session.tenantId, actual.id);

    return {
      output: { rolId: actual.id },
      audit: { entidadId: actual.id, valorAnterior: snapshotDeRol(actual) },
    };
  },
});

export async function eliminarRol(input: EliminarRolInput): Promise<{ rolId: string }> {
  return eliminarRolCommand.execute(input);
}
