/**
 * `getTomaReceta` (M11): everything the toma workspace
 * (/preparaciones/recetas/[recetaId]) shows -- the receta (header, toma,
 * ítems with componentes), each ítem's latest ficha técnica with its líneas
 * de pesaje, and each ítem's INICIADA/CONFIRMADA preparación. `null` when
 * the receta does not exist (in this tenant).
 *
 * `preparaciones.iniciar`, like every /preparaciones read. The embedded
 * receta edit form reads its own data through `recetas.ver` (recetas
 * module), gated on the recetas permisos by the page.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getRecetaDeToma } from "../infrastructure/preparacion-repository";
import type { FichaDeItemToma, ItemDeToma, LineaDeFichaToma, RecetaDeToma } from "../infrastructure/preparacion-repository";

export type { FichaDeItemToma, ItemDeToma, LineaDeFichaToma, RecetaDeToma };

const getTomaRecetaInput = z.object({ recetaId: uuid });

export const getTomaRecetaQuery = defineQuery({
  name: "preparaciones.toma.ver",
  permiso: "preparaciones.iniciar",
  input: getTomaRecetaInput,
  handler: async ({ tx, session, input }): Promise<RecetaDeToma | null> => getRecetaDeToma(tx, session.tenantId, input.recetaId),
});

export async function getTomaReceta(recetaId: string): Promise<RecetaDeToma | null> {
  return getTomaRecetaQuery.execute({ recetaId });
}
