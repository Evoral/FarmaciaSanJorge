/**
 * `listDrogas` (M06, FASE 4 point 4.2). Read-only. Gated on `drogas.editar`
 * -- plan §7's matrix has no dedicated `drogas.ver`, and every droga action
 * (crear/editar/baja/reactivar) shares the exact same role grant (FAR, DT,
 * ADM -- migration 0002's seed), so reusing `drogas.editar` for reads changes
 * nothing about who can see the list (same precedent as
 * modules/unidades/application/list-unidades.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDrogas as listDrogasRepo } from "../infrastructure/droga-repository";
import type { ListDrogasResult } from "../infrastructure/droga-repository";

const listDrogasInput = z.object({
  search: z.string().trim().optional(),
  soloControladas: z.boolean().optional(),
  bajoMinimo: z.boolean().optional(),
  soloVigentes: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListDrogasInput = z.infer<typeof listDrogasInput>;

export const listDrogasQuery = defineQuery({
  name: "drogas.listar",
  permiso: "drogas.editar",
  input: listDrogasInput,
  handler: async ({ tx, session, input }) => {
    return listDrogasRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      soloControladas: input.soloControladas,
      bajoMinimo: input.bajoMinimo,
      soloVigentes: input.soloVigentes,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listDrogas(input: ListDrogasInput): Promise<ListDrogasResult> {
  return listDrogasQuery.execute(input);
}
