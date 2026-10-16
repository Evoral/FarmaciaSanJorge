/**
 * `listAsientosJornada` -- the recetario asientos registered on the jornada
 * the DT is about to sign, paginated, so they can review what the firma
 * covers. Gated on `cierres.ver` (same audience as the pending list).
 */
import { defineQuery } from "@/shared/usecase";
import { listAsientosJornadaFiltro } from "../domain/filtros";
import type { ListAsientosJornadaFiltroInput } from "../domain/filtros";
import { listAsientosJornada as listAsientosJornadaDb } from "../infrastructure/cierre-repository";
import type { AsientoJornadaItem } from "../infrastructure/cierre-repository";

export interface ListAsientosJornadaResultado {
  items: AsientoJornadaItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const listAsientosJornadaQuery = defineQuery({
  name: "cierres.jornadas.asientos",
  permiso: "cierres.ver",
  input: listAsientosJornadaFiltro,
  handler: async ({ tx, session, input }): Promise<ListAsientosJornadaResultado> => {
    const { items, total } = await listAsientosJornadaDb(tx, {
      tenantId: session.tenantId,
      fecha: input.fecha,
      page: input.page,
      pageSize: input.pageSize,
    });
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
});

export async function listAsientosJornada(input: ListAsientosJornadaFiltroInput): Promise<ListAsientosJornadaResultado> {
  return listAsientosJornadaQuery.execute(input);
}
