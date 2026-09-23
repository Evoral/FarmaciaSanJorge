/**
 * `getUnidad` (M05, FASE 4 point 4.1): single-row read for
 * `/admin/unidades/[id]`. Same permiso reuse as list-unidades.ts.
 *
 * m1 (review finding, DP-39): also returns `drogasQueLaUsan`, the TRUE
 * cross-tenant count of drogas referencing this unidad (via migration
 * 0028's `fsj.contar_drogas_por_unidad`) -- `usada` alone only says "at
 * least one", which is not enough for a truthful edit/baja warning.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { contarDrogasQueUsanUnidad, getUnidadParaAccion } from "../infrastructure/unidad-repository";
import type { UnidadParaAccion } from "../infrastructure/unidad-repository";

const getUnidadInput = z.object({ id: uuid });

export interface UnidadConUso extends UnidadParaAccion {
  drogasQueLaUsan: number;
}

export const getUnidadQuery = defineQuery({
  name: "unidades.ver",
  permiso: "unidades.editar",
  input: getUnidadInput,
  handler: async ({ tx, input }) => {
    const unidad = await getUnidadParaAccion(tx, input.id);
    if (!unidad) return null;
    const drogasQueLaUsan = await contarDrogasQueUsanUnidad(tx, input.id);
    return { ...unidad, drogasQueLaUsan };
  },
});

export async function getUnidad(id: string): Promise<UnidadConUso | null> {
  return getUnidadQuery.execute({ id });
}
