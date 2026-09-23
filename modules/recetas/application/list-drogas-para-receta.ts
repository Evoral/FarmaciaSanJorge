/**
 * `listDrogasParaReceta` (M09, FASE 6 point 6.1): the droga picker for the
 * item/componente form. Gated on `recetas.crear` (task binding decision --
 * "declared under recetas.crear so ATENCION_PUBLICO can use it"), NOT
 * modules/drogas's own `listDrogas` (gated on `drogas.editar`, which ATP
 * lacks). Excludes drogas given de baja (own repository function).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDrogasParaReceta as listRepo } from "../infrastructure/receta-repository";
import type { DrogaOpcion } from "../infrastructure/receta-repository";

export type { DrogaOpcion };

const input = z.object({ search: z.string().trim().optional() });

export const listDrogasParaRecetaQuery = defineQuery({
  name: "recetas.drogas.listar",
  permiso: "recetas.crear",
  input,
  handler: async ({ tx, session, input: parsed }) => listRepo(tx, session.tenantId, parsed.search),
});

export async function listDrogasParaReceta(search?: string): Promise<DrogaOpcion[]> {
  return listDrogasParaRecetaQuery.execute({ search });
}
