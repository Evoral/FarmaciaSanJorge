/** `/libro` (FASE 9, M12 point 9.1). Consulta del libro recetario: filtros por rango de fechas/números, estado, texto paciente/médico, paginación. */
import Link from "next/link";
import { BookOpen, ChevronRight, Download, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listAsientosRecetario } from "@/modules/libro/application/list-asientos-recetario";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";
import { LibroNav, tonoEstadoAsiento } from "@/modules/libro/ui/libro-nav";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { AsientoBuscador } from "@/modules/libro/ui/asiento-buscador";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";
import { formatFechaIso } from "@/shared/format/fecha";

const PAGE_SIZE = 25;

type ParamLibro = "fechaDesde" | "fechaHasta" | "numeroDesde" | "numeroHasta" | "estado" | "texto";
const PARAMS_FILTRO: readonly ParamLibro[] = ["fechaDesde", "fechaHasta", "numeroDesde", "numeroHasta", "estado", "texto"];

interface LibroPageProps {
  searchParams: Promise<Partial<Record<ParamLibro | "page", string>>>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function LibroPage({ searchParams }: LibroPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const filtro = {
    fechaDesde: params.fechaDesde || undefined,
    fechaHasta: params.fechaHasta || undefined,
    numeroDesde: params.numeroDesde || undefined,
    numeroHasta: params.numeroHasta || undefined,
    estado: params.estado === "VIGENTE" || params.estado === "ANULADO" ? (params.estado as "VIGENTE" | "ANULADO") : undefined,
    texto: params.texto || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const result = await listAsientosRecetario(filtro);
  const puedeExportar = can(session, "libro.exportar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    if (params.numeroDesde) qs.set("numeroDesde", params.numeroDesde);
    if (params.numeroHasta) qs.set("numeroHasta", params.numeroHasta);
    if (params.estado) qs.set("estado", params.estado);
    if (params.texto) qs.set("texto", params.texto);
    qs.set("page", String(targetPage));
    return `/libro?${qs.toString()}`;
  }

  function exportHref(kind: "csv" | "pdf"): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    if (params.numeroDesde) qs.set("numeroDesde", params.numeroDesde);
    if (params.numeroHasta) qs.set("numeroHasta", params.numeroHasta);
    if (params.estado) qs.set("estado", params.estado);
    if (params.texto) qs.set("texto", params.texto);
    return `/api/libro/export/${kind}?${qs.toString()}`;
  }

  function sinFiltroHref(param: ParamLibro): string {
    const qs = new URLSearchParams();
    for (const key of PARAMS_FILTRO) if (key !== param && params[key]) qs.set(key, params[key]!);
    const query = qs.toString();
    return query ? `/libro?${query}` : "/libro";
  }

  const chips: { key: ParamLibro; label: string; value: string }[] = [];
  if (params.texto) chips.push({ key: "texto", label: "Paciente / médico", value: params.texto });
  if (params.estado) chips.push({ key: "estado", label: "Estado", value: params.estado === "ANULADO" ? "Anulado" : params.estado === "VIGENTE" ? "Vigente" : params.estado });
  if (params.fechaDesde) chips.push({ key: "fechaDesde", label: "Desde", value: formatFechaIso(params.fechaDesde) });
  if (params.fechaHasta) chips.push({ key: "fechaHasta", label: "Hasta", value: formatFechaIso(params.fechaHasta) });
  if (params.numeroDesde) chips.push({ key: "numeroDesde", label: "Nº desde", value: params.numeroDesde });
  if (params.numeroHasta) chips.push({ key: "numeroHasta", label: "Nº hasta", value: params.numeroHasta });
  const hayFiltros = chips.length > 0;
  const filtrosEnPanel = chips.filter((chip) => chip.key !== "texto").length;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Libro" }]}
        title="Libro recetario"
        description="Asientos del libro digital, en orden correlativo. Cada asiento queda encadenado por hash."
        actions={
          puedeExportar ? (
            <>
              <a href={exportHref("csv")} className="btn btn-secondary">
                <Download className="size-4" aria-hidden />
                CSV
              </a>
              <a href={exportHref("pdf")} className="btn btn-secondary">
                <Download className="size-4" aria-hidden />
                PDF
              </a>
            </>
          ) : null
        }
      />

      <LibroNav actual="recetario" />

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros del libro recetario" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="texto" value={params.texto ?? ""} />
          <div className="min-w-0 flex-1 md:w-96 md:flex-none">
            <AsientoBuscador listaHref={sinFiltroHref("texto")} busquedaActual={params.texto} />
          </div>
          <FilterDrawer activeCount={filtrosEnPanel}>
            <div className="field">
              <label htmlFor="estado" className="field-label">
                Estado
              </label>
              <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
                <option value="">Todos</option>
                <option value="VIGENTE">Vigente</option>
                <option value="ANULADO">Anulado</option>
              </select>
            </div>
            <div className="field">
              <span id="libro-fecha-label" className="field-label">
                Fecha
              </span>
              <div className="range-field" role="group" aria-labelledby="libro-fecha-label">
                <label htmlFor="fechaDesde" className="sr-only">
                  Desde
                </label>
                <DateInput id="fechaDesde" name="fechaDesde" defaultValue={params.fechaDesde ?? ""} />
                <span className="range-field-sep" aria-hidden>
                  a
                </span>
                <label htmlFor="fechaHasta" className="sr-only">
                  Hasta
                </label>
                <DateInput id="fechaHasta" name="fechaHasta" defaultValue={params.fechaHasta ?? ""} />
              </div>
            </div>
            <div className="field">
              <span id="libro-numero-label" className="field-label">
                Nº de asiento
              </span>
              <div className="range-field" role="group" aria-labelledby="libro-numero-label">
                <label htmlFor="numeroDesde" className="sr-only">
                  Nº desde
                </label>
                <input id="numeroDesde" name="numeroDesde" type="number" min={1} defaultValue={params.numeroDesde ?? ""} placeholder="Desde" className="input w-24 font-mono" />
                <span className="range-field-sep" aria-hidden>
                  a
                </span>
                <label htmlFor="numeroHasta" className="sr-only">
                  Nº hasta
                </label>
                <input id="numeroHasta" name="numeroHasta" type="number" min={1} defaultValue={params.numeroHasta ?? ""} placeholder="Hasta" className="input w-24 font-mono" />
              </div>
            </div>
          </FilterDrawer>
        </FilterForm>

        {hayFiltros ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={sinFiltroHref(chip.key)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/libro" scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "asiento" : "asientos"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún asiento coincide con los filtros aplicados."
                action={
                  <Link href="/libro" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<BookOpen className="size-5" />} title="Todavía no hay asientos" description="Los asientos se generan al confirmar cada preparación." />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Nº
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Fecha
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Paciente
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Médico
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => {
                    const estadoVisual = resolverEstadoVisualAsiento({
                      estado: item.estado,
                      anulacion: item.anulacion,
                      rectificativoNumeroCorrelativo: item.rectificativoNumeroCorrelativo,
                    });
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5">
                          <Link href={`/libro/${item.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                            {item.numeroCorrelativo}
                          </Link>
                          {item.origen === "RECTIFICATIVO" ? <span className="block text-xs text-zinc-500">Rectifica Nº {item.asientoOriginalNumeroCorrelativo}</span> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatFechaIso(item.fechaAsiento)}</td>
                        <td className="px-3 py-2.5 text-zinc-900">
                          {item.pacienteTexto}
                          <span className="block text-xs text-zinc-500 md:hidden">{item.medicoTexto}</span>
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">{item.medicoTexto}</td>
                        <td className="px-3 py-2.5">
                          <ToneBadge tone={tonoEstadoAsiento(estadoVisual.kind)}>{etiquetaEstadoVisual(estadoVisual)}</ToneBadge>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link href={`/libro/${item.id}`} aria-label={`Ver el asiento Nº ${item.numeroCorrelativo}`} className="btn btn-ghost btn-sm btn-icon">
                            <ChevronRight className="size-4" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación del libro recetario" />
        </div>
      </div>
    </div>
  );
}
