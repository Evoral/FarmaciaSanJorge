/**
 * `listStockDrogas` (M07, FASE 5 point 5.2). Read-only, `stock.ver` (plan
 * §7: granted to every role). Stock always comes from `fsj.v_stock_droga`
 * -- see `modules/stock/infrastructure/partida-repository.ts`'s module doc
 * comment ("NO HACER": never sum in application code). Every filter,
 * the order and the pagination run in SQL; filters combine with AND.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { ORDENES_STOCK_DROGAS } from "../domain/partida";
import { getDiasAlertaVencimiento, listStockDrogas as listStockDrogasRepo } from "../infrastructure/partida-repository";
import type { ListStockDrogasResult } from "../infrastructure/partida-repository";

const listStockDrogasInput = z.object({
  search: z.string().trim().optional(),
  soloBajoMinimo: z.boolean().optional(),
  soloSinStock: z.boolean().optional(),
  conPartidasPorVencer: z.boolean().optional(),
  conPartidasVencidas: z.boolean().optional(),
  soloControladas: z.boolean().optional(),
  orden: z.enum(ORDENES_STOCK_DROGAS).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListStockDrogasInput = z.infer<typeof listStockDrogasInput>;

export const listStockDrogasQuery = defineQuery({
  name: "stock.drogas.listar",
  permiso: "stock.ver",
  input: listStockDrogasInput,
  handler: async ({ tx, session, input }) => {
    // Same window as the "por vencer" alert (alertas-stock.ts); only read when that filter is on.
    const diasAlertaVencimiento = input.conPartidasPorVencer ? await getDiasAlertaVencimiento(tx, session.tenantId) : 0;
    return listStockDrogasRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      soloBajoMinimo: input.soloBajoMinimo,
      soloSinStock: input.soloSinStock,
      conPartidasPorVencer: input.conPartidasPorVencer,
      conPartidasVencidas: input.conPartidasVencidas,
      soloControladas: input.soloControladas,
      diasAlertaVencimiento,
      orden: input.orden,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listStockDrogas(input: ListStockDrogasInput): Promise<ListStockDrogasResult> {
  return listStockDrogasQuery.execute(input);
}
