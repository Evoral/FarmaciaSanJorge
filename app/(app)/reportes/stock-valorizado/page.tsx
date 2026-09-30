/**
 * `/reportes/stock-valorizado` (FASE 13 point 13.2). Stock valorizado por
 * partida, con subtotales por droga y total general. "Excluir vencidas"
 * (`excluirVencidas=1`) replaces the old `incluirVencidas=0` (still honored
 * for old links): a checkbox that is ON by default cannot be turned off
 * through a GET form, since an unchecked box sends nothing. The export API
 * keeps its own `incluirVencidas=0` contract.
 */
import Link from "next/link";
import { reporteValorizado } from "@/modules/stock/application/reporte-valorizado";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterMultiSelect } from "@/shared/ui/filter-multi-select";

const PAGE_SIZE = 25;

interface StockValorizadoPageProps {
  searchParams: Promise<{ search?: string; excluirVencidas?: string; incluirVencidas?: string; soloConSaldo?: string; page?: string }>;
}

export default async function StockValorizadoPage({ searchParams }: StockValorizadoPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const incluirVencidas = !(params.excluirVencidas === "1" || params.incluirVencidas === "0");
  const soloConSaldo = params.soloConSaldo === "1";

  const [result, { catalogo }] = await Promise.all([
    reporteValorizado({ search: params.search || undefined, incluirVencidas, soloConSaldo, page, pageSize: PAGE_SIZE }),
    getCatalogoUnidades(),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (!incluirVencidas) qs.set("excluirVencidas", "1");
    if (soloConSaldo) qs.set("soloConSaldo", "1");
    qs.set("page", String(targetPage));
    return `/reportes/stock-valorizado?${qs.toString()}`;
  }

  function exportHref(kind: "csv" | "pdf"): string {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (!incluirVencidas) qs.set("incluirVencidas", "0");
    if (soloConSaldo) qs.set("soloConSaldo", "1");
    return `/api/stock/valorizado/export/${kind}?${qs.toString()}`;
  }

  const subtotalPorDroga = new Map(result.subtotales.map((s) => [s.drogaId, s.valorSubtotal]));
  let drogaAnterior: string | null = null;

  return (
    <div className="page">
      <div className="mb-2">
        <Link href="/reportes" className="text-sm underline">
          ← Volver a reportes
        </Link>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock valorizado</h1>
        <div className="flex gap-2">
          <a href={exportHref("csv")} className="btn btn-secondary">
            Exportar CSV
          </a>
          <a href={exportHref("pdf")} className="btn btn-secondary">
            Exportar PDF
          </a>
        </div>
      </div>

      <p className="mb-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
        Valorizado al costo actual de cada partida (no hay historial de costos).
      </p>

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de stock valorizado" hasActiveFilters={Boolean(params.search || !incluirVencidas || soloConSaldo)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="search" className="text-sm font-medium">
            Droga
          </label>
          <input id="search" name="search" type="search" defaultValue={params.search ?? ""} className="input" />
        </div>
        <FilterMultiSelect
          options={[
            { name: "excluirVencidas", label: "Excluir vencidas", checked: !incluirVencidas },
            { name: "soloConSaldo", label: "Solo con saldo", checked: soloConSaldo },
          ]}
        />
      </FilterForm>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} partida{result.total === 1 ? "" : "s"} encontrada{result.total === 1 ? "" : "s"}. Total general: {result.granTotal}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Droga</th>
              <th scope="col" className="px-3 py-2 font-medium">Lote</th>
              <th scope="col" className="px-3 py-2 font-medium">Vencimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad disponible</th>
              <th scope="col" className="px-3 py-2 font-medium">Costo unitario</th>
              <th scope="col" className="px-3 py-2 font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron partidas con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((item) => {
                const filas = [];
                if (drogaAnterior !== null && drogaAnterior !== item.drogaId) {
                  filas.push(
                    <tr key={`subtotal-${drogaAnterior}`} className="bg-zinc-50 dark:bg-zinc-900">
                      <td colSpan={5} className="px-3 py-1 text-right font-medium">
                        Subtotal
                      </td>
                      <td className="px-3 py-1 font-medium">{subtotalPorDroga.get(drogaAnterior) ?? "0"}</td>
                    </tr>,
                  );
                }
                drogaAnterior = item.drogaId;
                filas.push(
                  <tr key={item.partidaId}>
                    <td className="px-3 py-2">{item.drogaNombre}</td>
                    <td className="px-3 py-2">{item.lote}</td>
                    <td className="px-3 py-2">{item.fechaVencimiento}</td>
                    <td className="px-3 py-2">
                      <Cantidad valor={formatCantidad(item.cantidadDisponible, { id: item.unidadId, simbolo: item.unidadSimbolo }, catalogo)} />
                    </td>
                    <td className="px-3 py-2">{item.costoUnitario}</td>
                    <td className="px-3 py-2">{item.valor}</td>
                  </tr>,
                );
                return filas;
              })
            )}
          </tbody>
          {result.items.length > 0 ? (
            <tfoot>
              <tr className="bg-zinc-50 dark:bg-zinc-900">
                <td colSpan={5} className="px-3 py-1 text-right font-medium">
                  Subtotal
                </td>
                <td className="px-3 py-1 font-medium">{drogaAnterior ? subtotalPorDroga.get(drogaAnterior) ?? "0" : "0"}</td>
              </tr>
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right font-semibold">
                  Total general
                </td>
                <td className="px-3 py-2 font-semibold">{result.granTotal}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de stock valorizado" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link href={pageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}>
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
