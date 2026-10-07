"use server";

/**
 * Read-only droga search for the stock autocompletes (`/stock`, `/stock/ajustes`, the "Registrar ajuste" droga step).
 * A thin wrapper over the existing `listStockDrogas` query: same `stock.ver` permiso (checked by the query itself),
 * same search (name or vigente synonym, accent-insensitive -- docs/specs/sinonimos-droga.md), no writes. The available stock comes formatted with the same readable unit as the `/stock` table.
 * Drogas are not personal data, but the term still travels as a POST argument, never a URL.
 */
import { listStockDrogas } from "@/modules/stock/application/list-stock-drogas";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";

const MAX_RESULTADOS = 10;
const MAX_LARGO_BUSQUEDA = 100;

export interface DrogaStockSugerencia {
  drogaId: string;
  drogaNombre: string;
  /** Available stock, already formatted (e.g. "1,25 kg"). */
  disponible: string;
  /** The synonym the search matched through, when the name itself did not match (shown as a quiet hint). */
  sinonimo: string | null;
}

export async function buscarDrogasStockAction(busqueda: string): Promise<DrogaStockSugerencia[]> {
  const search = String(busqueda ?? "").trim().slice(0, MAX_LARGO_BUSQUEDA);
  const [stock, { catalogo }] = await Promise.all([listStockDrogas({ search: search || undefined, page: 1, pageSize: MAX_RESULTADOS }), getCatalogoUnidades()]);
  return stock.items.map((item) => ({
    drogaId: item.drogaId,
    drogaNombre: item.drogaNombre,
    disponible: formatCantidad(item.stockDisponible, { id: item.unidadId, simbolo: item.unidadSimbolo }, catalogo).texto,
    sinonimo: item.sinonimoCoincidente,
  }));
}
