/**
 * `listDtParaPerdida`: the DT picker of the toma workspace's "Registrar
 * pérdida" co-firma (./registrar-perdida-reserva.ts). Same list as the stock
 * ajuste's (`listDtParaCoFirmaEnTx`, modules/stock), under the permiso of
 * whoever prepares (`preparaciones.confirmar`), not `stock.ajuste.registrar`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDtParaCoFirmaEnTx, type DtParaCoFirma } from "@/modules/stock/application/list-dt-para-co-firma";

export const listDtParaPerdidaQuery = defineQuery({
  name: "preparaciones.perdida.dtParaCoFirma",
  permiso: "preparaciones.confirmar",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<DtParaCoFirma[]> => listDtParaCoFirmaEnTx(tx, session.tenantId),
});

export async function listDtParaPerdida(): Promise<DtParaCoFirma[]> {
  return listDtParaPerdidaQuery.execute({});
}
