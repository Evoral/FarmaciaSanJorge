/**
 * `listAjustes` (M07, `/stock/ajustes`). Read-only, `stock.ver` -- the same
 * permiso that already exposes these AJUSTE movements through the partida
 * kardex (`kardex-movimientos.ts`) and the kardex report, so this list adds
 * no new visibility. Newest first; the search (droga name or lote), motivo
 * and jornada range filters, the order and the pagination all run in SQL
 * (`partida-repository.ts#listAjustesSql`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { MOTIVOS_AJUSTE } from "../domain/partida";
import { esFechaIso } from "../domain/ajustes-listado";
import { listAjustes as listAjustesRepo } from "../infrastructure/partida-repository";
import type { ListAjustesResult } from "../infrastructure/partida-repository";

const fechaIso = z.string().refine(esFechaIso, { message: "Ingresá una fecha válida." });

const listAjustesInput = z
  .object({
    search: z.string().trim().optional(),
    motivoAjuste: z.enum(MOTIVOS_AJUSTE).optional(),
    desde: fechaIso.optional(),
    hasta: fechaIso.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })
  .refine((input) => !input.desde || !input.hasta || input.desde <= input.hasta, {
    message: "La fecha \"Desde\" no puede ser posterior a la fecha \"Hasta\".",
    path: ["desde"],
  });

export type ListAjustesInput = z.input<typeof listAjustesInput>;

export const listAjustesQuery = defineQuery({
  name: "stock.ajustes.listar",
  permiso: "stock.ver",
  input: listAjustesInput,
  handler: async ({ tx, session, input }) =>
    listAjustesRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      motivoAjuste: input.motivoAjuste,
      desde: input.desde,
      hasta: input.hasta,
      page: input.page,
      pageSize: input.pageSize,
    }),
});

export async function listAjustes(input: ListAjustesInput): Promise<ListAjustesResult> {
  return listAjustesQuery.execute(input);
}
