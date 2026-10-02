/**
 * `listCatalogoPermisos` (DP-03): the role-assignable permiso catalog, in
 * catalog order with human descriptions and categories, plus the actor's
 * GRANTABLE permisos (held ones, plus every operativo one for an
 * ADMINISTRADOR), for the "Nuevo rol" editor. Gated on `roles.gestionar` --
 * only the create page uses it (the edit page gets the same from `getRol`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import type { Permiso } from "@/modules/auth/domain/permisos";
import type { PermisoCatalogo } from "../domain/roles";
import { listCatalogoPermisos as listCatalogoPermisosRepo } from "../infrastructure/rol-repository";
import { otorgablesDelActor } from "./roles-asignables";

export interface CatalogoParaEditor {
  catalogo: PermisoCatalogo[];
  otorgables: Permiso[];
}

export const listCatalogoPermisosQuery = defineQuery({
  name: "roles.catalogoPermisos",
  permiso: "roles.gestionar",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<CatalogoParaEditor> => {
    const catalogo = await listCatalogoPermisosRepo(tx);
    const { otorgables } = await otorgablesDelActor(tx, session);
    return { catalogo, otorgables: [...otorgables].sort() };
  },
});

export async function listCatalogoPermisos(): Promise<CatalogoParaEditor> {
  return listCatalogoPermisosQuery.execute({});
}
