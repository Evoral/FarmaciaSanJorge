/** `listHistorico` -- FASE 9, M12 point 9.5 (consulta de asientos históricos digitalizados). */
import { defineQuery } from "@/shared/usecase";
import { listHistoricoFiltro } from "../domain/filtros";
import { listAsientosHistoricos } from "../infrastructure/historico-repository";
import type { HistoricoListResult } from "../infrastructure/historico-repository";
import type { ListHistoricoFiltro } from "../domain/filtros";

export const listHistoricoQuery = defineQuery({
  name: "libro.historico.listar",
  permiso: "libro.ver",
  input: listHistoricoFiltro,
  handler: async ({ tx, session, input }) => listAsientosHistoricos(tx, session.tenantId, input),
});

export async function listHistorico(input: ListHistoricoFiltro): Promise<HistoricoListResult> {
  return listHistoricoQuery.execute(input);
}
