/**
 * `/reportes/recetas` (FASE 13 point 13.4). Recetas por estado: conteos + listado filtrado (estado, fecha de ingreso),
 * con exportación CSV auditada. The per-estado counts are the estado filter itself (`StatusSummary` tabs, same as
 * `/recetas`); the fecha de ingreso range lives in the filter bar.
 */
import Link from "next/link";
import { ClipboardList, Download, SearchX, X } from "lucide-react";
import { reporteRecetasPorEstado, listRecetasReporte } from "@/modules/recetas/application/reporte-recetas";
import { ESTADOS_RECETA, esEstadoTerminal } from "@/modules/recetas/domain/receta";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusSummary } from "@/shared/ui/status-summary";
import { StatusBadge, estadoTone } from "@/shared/ui/status-badge";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";

const PAGE_SIZE = 25;

type FilterParam = "estado" | "ingresoDesde" | "ingresoHasta";

interface ReporteRecetasPageProps {
  searchParams: Promise<{ estado?: string; ingresoDesde?: string; ingresoHasta?: string; page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function ReporteRecetasPage({ searchParams }: ReporteRecetasPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const estado = params.estado && (ESTADOS_RECETA as readonly string[]).includes(params.estado) ? (params.estado as (typeof ESTADOS_RECETA)[number]) : undefined;

  const [conteos, result] = await Promise.all([
    reporteRecetasPorEstado(),
    listRecetasReporte({ estado, ingresoDesde: params.ingresoDesde || undefined, ingresoHasta: params.ingresoHasta || undefined, page, pageSize: PAGE_SIZE }),
  ]);
  const totalRecetas = conteos.reduce((sum, c) => sum + c.cantidad, 0);

  /** The report's URL with some params replaced ("" removes one); `page` always resets. */
  function filtersHref(cambios: Partial<Record<FilterParam, string>>): string {
    const actuales: Record<FilterParam, string> = { estado: params.estado ?? "", ingresoDesde: params.ingresoDesde ?? "", ingresoHasta: params.ingresoHasta ?? "" };
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...actuales, ...cambios })) if (value) qs.set(key, value);
    const query = qs.toString();
    return query ? `/reportes/recetas?${query}` : "/reportes/recetas";
  }

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.estado) qs.set("estado", params.estado);
    if (params.ingresoDesde) qs.set("ingresoDesde", params.ingresoDesde);
    if (params.ingresoHasta) qs.set("ingresoHasta", params.ingresoHasta);
    qs.set("page", String(targetPage));
    return `/reportes/recetas?${qs.toString()}`;
  }

  function exportHref(): string {
    const qs = new URLSearchParams();
    if (params.estado) qs.set("estado", params.estado);
    if (params.ingresoDesde) qs.set("ingresoDesde", params.ingresoDesde);
    if (params.ingresoHasta) qs.set("ingresoHasta", params.ingresoHasta);
    return `/api/recetas/reporte/export/csv?${qs.toString()}`;
  }

  const chips: { key: FilterParam; label: string; value: string }[] = [];
  if (params.ingresoDesde) chips.push({ key: "ingresoDesde", label: "Ingreso desde", value: formatFechaIso(params.ingresoDesde) });
  if (params.ingresoHasta) chips.push({ key: "ingresoHasta", label: "Ingreso hasta", value: formatFechaIso(params.ingresoHasta) });
  const hayFiltros = Boolean(estado) || chips.length > 0;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Reportes", href: "/reportes" }, { label: "Recetas por estado" }]}
        title="Recetas por estado"
        description="Cuántas recetas hay en cada estado y el listado filtrado por fecha de ingreso."
        actions={
          <a href={exportHref()} className="btn btn-secondary">
            <Download className="size-4" aria-hidden />
            Exportar CSV
          </a>
        }
      />

      <StatusSummary
        label="Filtrar por estado"
        unit={["receta", "recetas"]}
        note={chips.length > 0 ? "Los totales por estado no aplican las fechas." : undefined}
        all={{ label: "Todas", count: totalRecetas, href: filtersHref({ estado: "" }), active: !estado }}
        items={conteos.map((c) => ({
          key: c.estado,
          label: ESTADO_RECETA_LABELS[c.estado],
          count: c.cantidad,
          // Clicking the active estado again clears it.
          href: filtersHref({ estado: c.estado === estado ? "" : c.estado }),
          active: c.estado === estado,
          tone: estadoTone(c.estado),
          secondary: esEstadoTerminal(c.estado),
        }))}
      />

      <section aria-label="Filtros" className="mb-4">
        {/* The estado is chosen in the summary above; this hidden field keeps it while the dates change. */}
        <FilterForm className="filter-bar" aria-label="Filtros de recetas por estado" hasActiveFilters={false}>
          <input type="hidden" name="estado" value={estado ?? ""} />
          <div className="field">
            <span id="ingreso-label" className="field-label">
              Fecha de ingreso
            </span>
            <div className="range-field" role="group" aria-labelledby="ingreso-label">
              <label htmlFor="ingresoDesde" className="sr-only">
                Ingreso desde
              </label>
              <DateInput id="ingresoDesde" name="ingresoDesde" defaultValue={params.ingresoDesde ?? ""} />
              <span className="range-field-sep" aria-hidden>
                a
              </span>
              <label htmlFor="ingresoHasta" className="sr-only">
                Ingreso hasta
              </label>
              <DateInput id="ingresoHasta" name="ingresoHasta" defaultValue={params.ingresoHasta ?? ""} />
            </div>
          </div>
        </FilterForm>

        {chips.length > 0 ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={filtersHref({ [chip.key]: "" })} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {hayFiltros ? (
              <Link href="/reportes/recetas" scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "receta" : "recetas"}
              {estado ? <span className="text-zinc-500"> · {ESTADO_RECETA_LABELS[estado]}</span> : null}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ninguna receta coincide con los filtros aplicados."
                action={
                  <Link href="/reportes/recetas" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<ClipboardList className="size-5" />} title="Todavía no hay recetas" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Nº
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Ingreso
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
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold">{r.numeroInterno}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono tabular-nums sm:table-cell">{new Date(r.fechaIngreso).toLocaleDateString("es-AR")}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-zinc-900">
                          {r.pacienteNombre} {r.pacienteApellido}
                        </span>
                        <span className="block text-xs text-zinc-500 md:hidden">
                          {r.medicoApellido}, {r.medicoNombre}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {r.medicoApellido}, {r.medicoNombre}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge estado={r.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de recetas por estado" />
        </div>
      </div>
    </div>
  );
}
