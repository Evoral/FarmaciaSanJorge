/** `listContralor` -- FASE 9, M12 point 9.4 (consulta de libros contralor por tipo/droga/fecha). */
import { defineQuery } from "@/shared/usecase";
import { listContralorFiltro } from "../domain/filtros";
import { listAsientosContralor, getFechaActivacionContralor } from "../infrastructure/contralor-repository";
import type { ContralorListResult } from "../infrastructure/contralor-repository";
import type { ListContralorFiltro } from "../domain/filtros";

export interface ListContralorResult extends ContralorListResult {
  /** `null` -> "Libros contralor llevados en forma manual" (spec §4). */
  fechaActivacionContralor: string | null;
}

export const listContralorQuery = defineQuery({
  name: "libro.contralor.listar",
  permiso: "libro.ver",
  input: listContralorFiltro,
  handler: async ({ tx, session, input }): Promise<ListContralorResult> => {
    const [resultado, fechaActivacion] = await Promise.all([
      listAsientosContralor(tx, session.tenantId, input),
      getFechaActivacionContralor(tx, session.tenantId),
    ]);
    return { ...resultado, fechaActivacionContralor: fechaActivacion ? fechaActivacion.toISOString() : null };
  },
});

export async function listContralor(input: ListContralorFiltro): Promise<ListContralorResult> {
  return listContralorQuery.execute(input);
}
