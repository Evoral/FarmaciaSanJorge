/**
 * `listUnidadesParaReceta` (M09, FASE 6 point 6.1): the unidad_medida picker
 * for the item/componente form. Gated on `recetas.crear` (same reasoning as
 * list-drogas-para-receta.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listUnidadesParaReceta as listRepo } from "../infrastructure/receta-repository";
import type { UnidadOpcion } from "../infrastructure/receta-repository";

export type { UnidadOpcion };

export const listUnidadesParaRecetaQuery = defineQuery({
  name: "recetas.unidades.listar",
  permiso: "recetas.crear",
  input: z.object({}),
  handler: async ({ tx }) => listRepo(tx),
});

export async function listUnidadesParaReceta(): Promise<UnidadOpcion[]> {
  return listUnidadesParaRecetaQuery.execute({});
}
