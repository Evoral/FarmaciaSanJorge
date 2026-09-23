/**
 * `listPartidasDroga` (M07, FASE 5 point 5.2). Read-only, `stock.ver`.
 * Partidas of ONE droga with their balances -- for `/stock/drogas/[id]` (or
 * the droga's stock detail panel).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { listPartidasDeDroga } from "../infrastructure/partida-repository";
import type { ListPartidasDrogaResult } from "../infrastructure/partida-repository";

const listPartidasDrogaInput = z.object({
  drogaId: uuid,
  soloConSaldo: z.boolean().optional(),
  soloVencidas: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListPartidasDrogaInput = z.infer<typeof listPartidasDrogaInput>;

export const listPartidasDrogaQuery = defineQuery({
  name: "stock.partidas.listar",
  permiso: "stock.ver",
  input: listPartidasDrogaInput,
  handler: async ({ tx, session, input }) =>
    listPartidasDeDroga(tx, {
      tenantId: session.tenantId,
      drogaId: input.drogaId,
      soloConSaldo: input.soloConSaldo,
      soloVencidas: input.soloVencidas,
      page: input.page,
      pageSize: input.pageSize,
    }),
});

export async function listPartidasDroga(input: ListPartidasDrogaInput): Promise<ListPartidasDrogaResult> {
  return listPartidasDrogaQuery.execute(input);
}
