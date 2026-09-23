/**
 * `listStockDrogas` (M07, FASE 5 point 5.2). Read-only, `stock.ver` (plan
 * §7: granted to every role). Stock always comes from `fsj.v_stock_droga`
 * -- see `modules/stock/infrastructure/partida-repository.ts`'s module doc
 * comment ("NO HACER": never sum in application code).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listStockDrogas as listStockDrogasRepo } from "../infrastructure/partida-repository";
import type { ListStockDrogasResult } from "../infrastructure/partida-repository";

const listStockDrogasInput = z.object({
  search: z.string().trim().optional(),
  soloBajoMinimo: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListStockDrogasInput = z.infer<typeof listStockDrogasInput>;

export const listStockDrogasQuery = defineQuery({
  name: "stock.drogas.listar",
  permiso: "stock.ver",
  input: listStockDrogasInput,
  handler: async ({ tx, session, input }) =>
    listStockDrogasRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      soloBajoMinimo: input.soloBajoMinimo,
      page: input.page,
      pageSize: input.pageSize,
    }),
});

export async function listStockDrogas(input: ListStockDrogasInput): Promise<ListStockDrogasResult> {
  return listStockDrogasQuery.execute(input);
}
