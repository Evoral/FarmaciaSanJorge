/**
 * `/cierres/historial` (FASE 10, M13a point 10.1). Historial paginado de
 * cierres firmados, con filtro por rango de fechas. Split out of `/cierres`,
 * which now only holds the pending jornadas and the firma.
 *
 * The "Historial de cierres" tab of the sidebar's "Gestión DT" section
 * (`../../nav-sections.ts#gestionDtSections`). Guarded on `cierres.ver`
 * here, same as the index tab.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileBarChart, History, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listCierres } from "@/modules/cierres/application/list-cierres";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";
import { SectionTabs } from "../../section-tabs";
import { gestionDtSections } from "../../nav-sections";

const PAGE_SIZE = 20;
const BASE_HREF = "/cierres/historial";

interface HistorialCierresPageProps {
  searchParams: Promise<{ fechaDesde?: string; fechaHasta?: string; page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");
const fechaFirmaFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

export default async function HistorialCierresPage({ searchParams }: HistorialCierresPageProps) {
  const session = await requireSession();
  const secciones = gestionDtSections(session);
  if (!can(session, "cierres.ver")) {
    redirect("/");
  }
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const puedeVerReporte = can(session, "cierres.reporte");

  const historial = await listCierres({ fechaDesde: params.fechaDesde, fechaHasta: params.fechaHasta, page, pageSize: PAGE_SIZE });

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    qs.set("page", String(targetPage));
    return `${BASE_HREF}?${qs.toString()}`;
  }

  function sinFiltroHref(param: "fechaDesde" | "fechaHasta"): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde && param !== "fechaDesde") qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta && param !== "fechaHasta") qs.set("fechaHasta", params.fechaHasta);
    const query = qs.toString();
    return query ? `${BASE_HREF}?${query}` : BASE_HREF;
  }

  const hayFiltros = Boolean(params.fechaDesde || params.fechaHasta);

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Gestión DT" }, { label: "Historial de cierres" }]}
        title="Historial de cierres"
        description="Jornadas ya firmadas por el Director Técnico."
        actions={
          puedeVerReporte ? (
            <Link href="/cierres/reporte" className="btn btn-secondary">
              <FileBarChart className="size-4" aria-hidden />
              Reporte de cumplimiento
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de gestión DT" links={secciones} />

      <section aria-label="Filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros del historial de cierres" hasActiveFilters={false}>
          <div className="field">
            <span id="historial-fecha-label" className="field-label">
              Jornada
            </span>
            <div className="range-field" role="group" aria-labelledby="historial-fecha-label">
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
        </FilterForm>

        {hayFiltros ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {params.fechaDesde ? (
              <span className="chip">
                Desde: <strong>{formatFechaIso(params.fechaDesde)}</strong>
                <Link href={sinFiltroHref("fechaDesde")} scroll={false} className="chip-remove" aria-label="Quitar filtro Desde">
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ) : null}
            {params.fechaHasta ? (
              <span className="chip">
                Hasta: <strong>{formatFechaIso(params.fechaHasta)}</strong>
                <Link href={sinFiltroHref("fechaHasta")} scroll={false} className="chip-remove" aria-label="Quitar filtro Hasta">
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(historial.total)}</span> {historial.total === 1 ? "cierre" : "cierres"}
            </p>
          </div>

          {historial.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="No hay cierres en ese rango de fechas."
                action={
                  <Link href={BASE_HREF} scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<History className="size-5" />} title="Todavía no hay cierres firmados" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Jornada
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Director Técnico
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Asientos
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Firmado
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
                  {historial.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/cierres/${item.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                          {formatFechaIso(item.fecha)}
                        </Link>
                        <span className="block truncate text-xs text-zinc-500 md:hidden">
                          {item.directorTecnicoApellido}, {item.directorTecnicoNombre}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {item.directorTecnicoApellido}, {item.directorTecnicoNombre}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{item.cantidadAsientos}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums sm:table-cell">{fechaFirmaFormat.format(item.fechaFirma)}</td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={item.fueraDeTermino ? "warn" : "success"}>{item.fueraDeTermino ? "Fuera de término" : "En término"}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/cierres/${item.id}`} aria-label={`Ver el cierre de la jornada ${formatFechaIso(item.fecha)}`} className="btn btn-ghost btn-sm btn-icon">
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={historial.total} hrefFor={pageHref} label="Paginación del historial de cierres" />
        </div>
      </div>
    </div>
  );
}
