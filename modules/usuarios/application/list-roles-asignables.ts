/**
 * `listRolesAsignables` (DP-03): role options of the session's tenant for
 * the usuarios forms (create, roles tab) and the usuarios list filter --
 * every role but SISTEMA, by display name. Replaces the old hardcoded
 * ROLES_ASIGNABLES/ROL_LABELS. Gated on `usuarios.listar`: every usuarios
 * screen hangs off the usuarios list (its tab is shown only with that
 * permiso, see app/(app)/nav-sections.ts). The commands re-validate every
 * submitted code server-side regardless (roles-asignables.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listRolesAsignables as listRolesAsignablesRepo, type RolOpcion } from "../infrastructure/rol-repository";

export type { RolOpcion };

export const listRolesAsignablesQuery = defineQuery({
  name: "usuarios.rolesAsignables",
  permiso: "usuarios.listar",
  input: z.object({}),
  handler: async ({ tx, session }) => listRolesAsignablesRepo(tx, session.tenantId),
});

export async function listRolesAsignables(): Promise<RolOpcion[]> {
  return listRolesAsignablesQuery.execute({});
}
