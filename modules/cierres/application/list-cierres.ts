/**
 * `listCierres` -- FASE 10, M13a point 10.1 (historial paginado, filtros por
 * rango de fechas). Gated on `cierres.ver`.
 */
import { defineQuery } from "@/shared/usecase";
import { listCierresFiltro } from "../domain/filtros";
import type { ListCierresFiltroInput } from "../domain/filtros";
import { listCierres as listCierresDb } from "../infrastructure/cierre-repository";
import type { CierreListItem } from "../infrastructure/cierre-repository";

export interface ListCierresResultado {
  items: CierreListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const listCierresQuery = defineQuery({
  name: "cierres.list",
  permiso: "cierres.ver",
  input: listCierresFiltro,
  handler: async ({ tx, session, input }): Promise<ListCierresResultado> => {
    const { items, total } = await listCierresDb(tx, {
      tenantId: session.tenantId,
      fechaDesde: input.fechaDesde,
      fechaHasta: input.fechaHasta,
      page: input.page,
      pageSize: input.pageSize,
    });
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
});

export async function listCierres(input: ListCierresFiltroInput): Promise<ListCierresResultado> {
  return listCierresQuery.execute(input);
}
