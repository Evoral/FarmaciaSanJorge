/**
 * `listRolesConPermisos` (M03, FASE 3 point 3.8). Read-only role/permission
 * matrix -- editing is DP-03 (unresolved in the plan), so no write use case
 * exists for this. Excludes SISTEMA (never shown -- see
 * modules/usuarios/domain/roles.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listRolesConPermisos as listRolesRepo } from "../infrastructure/usuario-repository";
import type { RolConPermisos } from "../infrastructure/usuario-repository";

export const listRolesConPermisosQuery = defineQuery({
  name: "roles.ver",
  permiso: "roles.ver",
  input: z.object({}),
  handler: async ({ tx }) => listRolesRepo(tx),
});

export async function listRolesConPermisos(): Promise<RolConPermisos[]> {
  return listRolesConPermisosQuery.execute({});
}
