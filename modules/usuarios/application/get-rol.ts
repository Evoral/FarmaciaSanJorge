/**
 * `getRol` (DP-03): one role of the session's tenant for its detail/edit
 * page, plus what the editor needs to render it -- the role-assignable
 * permiso catalog (with human descriptions and categories), the codes of
 * the roles the ACTOR holds (an actor cannot edit or delete a role they
 * hold, see modules/usuarios/domain/roles.ts#motivoNoGestionable) and the
 * actor's GRANTABLE permisos (the editor disables the rest; the commands
 * re-check). `null` for an unknown id or the hidden SISTEMA role (the page
 * renders not-found for both, never distinguishing them).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import type { Permiso } from "@/modules/auth/domain/permisos";
import { proteccionDeRol, ROL_SISTEMA, type PermisoCatalogo } from "../domain/roles";
import { findRolById, listCatalogoPermisos } from "../infrastructure/rol-repository";
import type { RolConPermisos } from "./list-roles-con-permisos";
import { otorgablesDelActor } from "./roles-asignables";

export interface GetRolResult {
  rol: RolConPermisos;
  catalogo: PermisoCatalogo[];
  rolesDelActor: string[];
  otorgables: Permiso[];
}

export const getRolQuery = defineQuery({
  name: "roles.detalle",
  permiso: "roles.ver",
  input: z.object({ id: uuid }),
  handler: async ({ tx, session, input }): Promise<GetRolResult | null> => {
    const rol = await findRolById(tx, session.tenantId, input.id);
    if (!rol || rol.codigo === ROL_SISTEMA) return null;
    const catalogo = await listCatalogoPermisos(tx);
    const { rolesDelActor, otorgables } = await otorgablesDelActor(tx, session);
    return { rol: { ...rol, proteccion: proteccionDeRol(rol) }, catalogo, rolesDelActor, otorgables: [...otorgables].sort() };
  },
});

export async function getRol(id: string): Promise<GetRolResult | null> {
  return getRolQuery.execute({ id });
}
