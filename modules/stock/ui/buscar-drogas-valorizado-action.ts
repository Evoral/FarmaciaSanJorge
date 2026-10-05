"use server";

/**
 * Read-only droga suggestions for the `/reportes/stock-valorizado` search: a thin wrapper over the existing
 * `reporteValorizado` query (same `stock.valorizado.ver` permiso, checked by the query itself; same droga-name search;
 * no writes, no export audit). It reads one page of matching partidas and keeps each droga once, so it only suggests
 * drogas the report can actually show.
 */
import { reporteValorizado } from "@/modules/stock/application/reporte-valorizado";
import type { SugerenciaNavegable } from "@/shared/ui/buscador-navegable";

const MAX_RESULTADOS = 10;
const MAX_LARGO_BUSQUEDA = 100;
const PARTIDAS_A_LEER = 100;

export async function buscarDrogasValorizadoAction(busqueda: string): Promise<SugerenciaNavegable[]> {
  const search = String(busqueda ?? "").trim().slice(0, MAX_LARGO_BUSQUEDA);
  const result = await reporteValorizado({ search: search || undefined, incluirVencidas: true, soloConSaldo: false, page: 1, pageSize: PARTIDAS_A_LEER });
  const drogas = new Map<string, SugerenciaNavegable>();
  for (const item of result.items) {
    if (!drogas.has(item.drogaId)) drogas.set(item.drogaId, { id: item.drogaId, label: item.drogaNombre });
    if (drogas.size >= MAX_RESULTADOS) break;
  }
  return [...drogas.values()];
}
