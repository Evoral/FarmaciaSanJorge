/**
 * `kardexMovimientos` (M07, FASE 5 point 5.2). Read-only, `stock.ver`.
 * Movement history for a partida (or a whole droga), with filters and
 * pagination -- for `/stock/partidas/[id]`'s kardex panel.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { kardexMovimientos as kardexMovimientosRepo } from "../infrastructure/partida-repository";
import type { KardexResult } from "../infrastructure/partida-repository";

const TIPOS_MOVIMIENTO = ["INGRESO_COMPRA", "EGRESO_PREPARACION", "AJUSTE"] as const;

const kardexMovimientosInput = z.object({
  partidaId: uuid.optional(),
  drogaId: uuid.optional(),
  tipo: z.enum(TIPOS_MOVIMIENTO).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type KardexMovimientosInput = z.infer<typeof kardexMovimientosInput>;

export const kardexMovimientosQuery = defineQuery({
  name: "stock.kardex.listar",
  permiso: "stock.ver",
  input: kardexMovimientosInput,
  handler: async ({ tx, session, input }) =>
    kardexMovimientosRepo(tx, {
      tenantId: session.tenantId,
      partidaId: input.partidaId,
      drogaId: input.drogaId,
      tipo: input.tipo,
      desde: input.desde,
      hasta: input.hasta,
      page: input.page,
      pageSize: input.pageSize,
    }),
});

export async function kardexMovimientos(input: KardexMovimientosInput): Promise<KardexResult> {
  return kardexMovimientosQuery.execute(input);
}
