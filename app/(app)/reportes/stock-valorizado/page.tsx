/**
 * `/reportes/stock-valorizado` (FASE 13 point 13.2). Stock valorizado por
 * partida, con subtotales por droga y total general. "Excluir vencidas"
 * (`excluirVencidas=1`) replaces the old `incluirVencidas=0` (still honored
 * for old links): a checkbox that is ON by default cannot be turned off
 * through a GET form, since an unchecked box sends nothing. The export API
 * keeps its own `incluirVencidas=0` contract.
 *
 * The droga search is an autocomplete (`BuscadorNavegable` without a detail
 * page): suggestions come from the same report query, and both a pick and the
 * last row set the same `search` param as before.
 */
import Link from "next/link";
import { Coins, Download, FileDown, Info, SearchX, X } from "lucide-react";
import { reporteValorizado } from "@/modules/stock/application/reporte-valorizado";
import { buscarDrogasValorizadoAction } from "@/modules/stock/ui/buscar-drogas-valorizado-action";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";
import { formatFechaIso } from "@/shared/format/fecha";
import { formatearCostoUnitario, formatearMonto } from "@/shared/format/monto";
import { Cantidad } from "@/shared/ui/cantidad";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterMultiSelect } from "@/shared/ui/filter-multi-select";
import { BuscadorNavegable } from "@/shared/ui/buscador-navegable";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";

const PAGE_SIZE = 25;

type FilterParam = "search" | "excluirVencidas" | "soloConSaldo";

interface StockValorizadoPageProps {
  searchParams: Promise<{ search?: string; excluirVencidas?: string; incluirVencidas?: string; soloConSaldo?: string; page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");
// Non-breaking space: "$" never ends a line apart from its figure.
const pesos = (valor: string) => `$ ${formatearMonto(valor)}`;

/** A subtotal/total row: the label under Droga and the amount under Valor; the middle cells mirror the columns' own breakpoints so nothing shifts when some are hidden. */
function FilaTotal({ etiqueta, monto, fuerte = false }: { etiqueta: string; monto: string; fuerte?: boolean }) {
  const texto = fuerte ? "font-semibold text-zinc-900" : "text-xs font-medium text-zinc-500";
  return (
    <tr className={fuerte ? "border-t border-zinc-200" : "bg-zinc-50"}>
      <td className={`px-3 py-1.5 ${texto}`}>{etiqueta}</td>
      <td className="hidden sm:table-cell" />
      <td className="hidden md:table-cell" />
      <td />
      <td className="hidden md:table-cell" />
      <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums text-zinc-900 ${fuerte ? "font-semibold" : "text-[0.8125rem] font-semibold"}`}>{pesos(monto)}</td>
    </tr>
  );
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

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (!incluirVencidas) qs.set("excluirVencidas", "1");
    if (soloConSaldo) qs.set("soloConSaldo", "1");
    qs.set("page", String(targetPage));
    return `/reportes/stock-valorizado?${qs.toString()}`;
  }

  /** The report's URL without one filter (the others kept). */
  function sinFiltroHref(param: FilterParam): string {
    const qs = new URLSearchParams();
    if (params.search && param !== "search") qs.set("search", params.search);
    if (!incluirVencidas && param !== "excluirVencidas") qs.set("excluirVencidas", "1");
    if (soloConSaldo && param !== "soloConSaldo") qs.set("soloConSaldo", "1");
    const query = qs.toString();
    return query ? `/reportes/stock-valorizado?${query}` : "/reportes/stock-valorizado";
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

  const chips: { key: FilterParam; label: string; value?: string }[] = [];
  if (params.search) chips.push({ key: "search", label: "Droga", value: params.search });
  if (!incluirVencidas) chips.push({ key: "excluirVencidas", label: "Sin vencidas" });
  if (soloConSaldo) chips.push({ key: "soloConSaldo", label: "Solo con saldo" });
  const hayFiltros = chips.length > 0;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Reportes", href: "/reportes" }, { label: "Stock valorizado" }]}
        title="Stock valorizado"
        description="El valor del stock de cada partida, con subtotales por droga."
        actions={
          <>
            <a href={exportHref("csv")} className="btn btn-secondary">
              <Download className="size-4" aria-hidden />
              CSV
            </a>
            <a href={exportHref("pdf")} className="btn btn-secondary">
              <FileDown className="size-4" aria-hidden />
              PDF
            </a>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-stretch gap-4">
        <div className="panel flex min-w-[14rem] flex-col justify-center px-5 py-4">
          <p className="text-xs text-zinc-500">Total general{hayFiltros ? " (con los filtros aplicados)" : ""}</p>
          <p className="summary-count mt-1.5 overflow-x-auto whitespace-nowrap">{pesos(result.granTotal)}</p>
        </div>
        <p role="note" className="alert alert-info min-w-0 flex-1 self-center">
          <Info aria-hidden />
          <span>Valorizado al costo actual de cada partida (no hay historial de costos).</span>
        </p>
      </div>

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de stock valorizado" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while the other filters change. */}
          <input type="hidden" name="search" value={params.search ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <BuscadorNavegable
              id="valorizado-buscar"
              label="Buscar droga"
              placeholder="Buscar droga por nombre"
              buscar={buscarDrogasValorizadoAction}
              listaHref={sinFiltroHref("search")}
              param="search"
              busquedaActual={params.search}
              textoVerTodos="Ver todas las drogas"
            />
          </div>
          <FilterMultiSelect
            options={[
              { name: "excluirVencidas", label: "Excluir vencidas", checked: !incluirVencidas },
              { name: "soloConSaldo", label: "Solo con saldo", checked: soloConSaldo },
            ]}
          />
        </FilterForm>

        {hayFiltros ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.value ? (
                  <>
                    {chip.label}: <strong>{chip.value}</strong>
                  </>
                ) : (
                  <strong>{chip.label}</strong>
                )}
                <Link href={sinFiltroHref(chip.key)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/reportes/stock-valorizado" scroll={false} className="btn btn-ghost btn-sm">
                Limpiar filtros
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "partida" : "partidas"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ninguna partida coincide con los filtros aplicados."
                action={
                  <Link href="/reportes/stock-valorizado" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Coins className="size-5" />} title="Todavía no hay partidas en stock" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Droga
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Lote
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Vencimiento
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Disponible
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">
                      Costo unitario
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => {
                    const filas = [];
                    if (drogaAnterior !== null && drogaAnterior !== item.drogaId) {
                      filas.push(<FilaTotal key={`subtotal-${drogaAnterior}`} etiqueta="Subtotal" monto={subtotalPorDroga.get(drogaAnterior) ?? "0"} />);
                    }
                    drogaAnterior = item.drogaId;
                    filas.push(
                      <tr key={item.partidaId}>
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-zinc-900">{item.drogaNombre}</span>
                          <span className="block font-mono text-xs text-zinc-500 sm:hidden">Lote {item.lote}</span>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono sm:table-cell">{item.lote}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono tabular-nums md:table-cell">{item.fechaVencimiento ? formatFechaIso(item.fechaVencimiento) : "No vence"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                          <Cantidad valor={formatCantidad(item.cantidadDisponible, { id: item.unidadId, simbolo: item.unidadSimbolo }, catalogo)} />
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums md:table-cell">$&nbsp;{formatearCostoUnitario(item.costoUnitario)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-zinc-900">{pesos(item.valor)}</td>
                      </tr>,
                    );
                    return filas;
                  })}
                </tbody>
                <tfoot>
                  {drogaAnterior ? <FilaTotal etiqueta="Subtotal" monto={subtotalPorDroga.get(drogaAnterior) ?? "0"} /> : null}
                  <FilaTotal etiqueta="Total general" monto={result.granTotal} fuerte />
                </tfoot>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de stock valorizado" />
        </div>
      </div>
    </div>
  );
}
