/**
 * `listUnidadesVigentesParaDroga` (M06, FASE 4 point 4.2): the unit picker
 * for the crear/editar droga form. Reads the GLOBAL `fsj.unidad_medida`
 * catalog (DP-39) filtered to non-baja rows -- gated on `drogas.editar`
 * (same role set as `drogas.crear`, migration 0002's seed) since both forms
 * need it.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listUnidadesVigentes as listUnidadesVigentesRepo } from "../infrastructure/droga-repository";
import type { UnidadOpcion } from "../infrastructure/droga-repository";

export const listUnidadesVigentesParaDrogaQuery = defineQuery({
  name: "drogas.unidades-vigentes",
  permiso: "drogas.editar",
  input: z.object({}),
  handler: async ({ tx }) => listUnidadesVigentesRepo(tx),
});

export async function listUnidadesVigentesParaDroga(): Promise<UnidadOpcion[]> {
  return listUnidadesVigentesParaDrogaQuery.execute({});
}
