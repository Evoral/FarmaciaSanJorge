/**
 * `listUnidades` (M05, FASE 4 point 4.1). Read-only, global catalog (DP-39).
 * Gated on `unidades.editar` rather than a separate `unidades.ver` -- plan
 * §7's matrix for this module only defines `unidades.crear/editar/baja`
 * (all ADM-only, migration 0002's seed), with no dedicated read permission --
 * same precedent as `modules/directores-tecnicos/application/list-designaciones.ts`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { TIPOS_MAGNITUD } from "../domain/unidad";
import { listUnidades as listUnidadesRepo } from "../infrastructure/unidad-repository";
import type { ListUnidadesResult } from "../infrastructure/unidad-repository";

const listUnidadesInput = z.object({
  search: z.string().trim().optional(),
  tipoMagnitud: z.enum(TIPOS_MAGNITUD).optional(),
  soloVigentes: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListUnidadesInput = z.infer<typeof listUnidadesInput>;

export const listUnidadesQuery = defineQuery({
  name: "unidades.listar",
  permiso: "unidades.editar",
  input: listUnidadesInput,
  handler: async ({ tx, input }) => {
    return listUnidadesRepo(tx, {
      search: input.search,
      tipoMagnitud: input.tipoMagnitud,
      soloVigentes: input.soloVigentes,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listUnidades(input: ListUnidadesInput): Promise<ListUnidadesResult> {
  return listUnidadesQuery.execute(input);
}
