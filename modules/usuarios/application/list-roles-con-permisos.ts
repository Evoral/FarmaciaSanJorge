/**
 * `listRolesConPermisos` (M03, FASE 3 point 3.8; DP-03 RESUELTA 2026-10-01).
 * The session tenant's roles (SISTEMA excluded -- never shown, see
 * modules/usuarios/domain/roles.ts) with their EFFECTIVE permisos (the full
 * catalog for the locked ADMINISTRADOR), how many usuarios hold each, and
 * its protection level, and whether a cuenta de sector may hold it
 * (`soloPersonal`: ROLES_VEDADOS_A_SECTOR, INV-SEC-001). Writes are separate commands gated on
 * `roles.gestionar` (crear-rol.ts / editar-rol.ts / eliminar-rol.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { proteccionDeRol, ROLES_VEDADOS_A_SECTOR, type ProteccionRol } from "../domain/roles";
import { listRolesDelTenant, type RolDetalle } from "../infrastructure/rol-repository";

export interface RolConPermisos extends RolDetalle {
  proteccion: ProteccionRol;
  /** A cuenta de sector can never hold it (Administrador, Director Técnico). */
  soloPersonal: boolean;
}

export const listRolesConPermisosQuery = defineQuery({
  name: "roles.ver",
  permiso: "roles.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<RolConPermisos[]> => {
    const roles = await listRolesDelTenant(tx, session.tenantId);
    return roles.map((rol) => ({ ...rol, proteccion: proteccionDeRol(rol), soloPersonal: ROLES_VEDADOS_A_SECTOR.includes(rol.codigo) }));
  },
});

export async function listRolesConPermisos(): Promise<RolConPermisos[]> {
  return listRolesConPermisosQuery.execute({});
}
