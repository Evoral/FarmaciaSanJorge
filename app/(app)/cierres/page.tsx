/**
 * `/cierres` (FASE 10, M13a point 10.1). Jornadas pendientes de firma
 * (oldest first, only the oldest can be signed -- chronological order,
 * INV-C19 is the real backstop) + historial paginado con filtros por rango
 * de fechas.
 *
 * Layout: the pending jornadas with the firma form beside them (the work),
 * then the signed history (the record).
 */
import Link from "next/link";
import { ChevronRight, CircleCheck, FileBarChart, History, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listJornadasPendientes, getJornadaActualCierres } from "@/modules/cierres/application/list-jornadas-pendientes";
import { listPreparacionesIniciadas } from "@/modules/cierres/application/list-preparaciones-iniciadas";
import { listCierres } from "@/modules/cierres/application/list-cierres";
import { FirmarForm } from "@/modules/cierres/ui/firmar-form";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

interface CierresPageProps {
  searchParams: Promise<{ fechaDesde?: string; fechaHasta?: string; page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function CierresPage({ searchParams }: CierresPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const puedeFirmar = can(session, "cierres.firmar");
  const puedeVerReporte = can(session, "cierres.reporte");

  const [pendientes, historial] = await Promise.all([
    listJornadasPendientes(),
    listCierres({ fechaDesde: params.fechaDesde, fechaHasta: params.fechaHasta, page, pageSize: PAGE_SIZE }),
  ]);

  const laMasAntigua = pendientes.find((p) => p.esLaMasAntigua) ?? null;
  const jornadaActual = puedeFirmar && laMasAntigua ? await getJornadaActualCierres() : null;
  const esJornadaActual = jornadaActual !== null && laMasAntigua !== null && laMasAntigua.fecha === jornadaActual;
  const preparaciones = puedeFirmar && laMasAntigua ? await listPreparacionesIniciadas() : [];

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    qs.set("page", String(targetPage));
    return `/cierres?${qs.toString()}`;
  }

  function sinFiltroHref(param: "fechaDesde" | "fechaHasta"): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde && param !== "fechaDesde") qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta && param !== "fechaHasta") qs.set("fechaHasta", params.fechaHasta);
    const query = qs.toString();
    return query ? `/cierres?${query}#historial` : "/cierres#historial";
  }

  const hayFiltros = Boolean(params.fechaDesde || params.fechaHasta);
  const fueraDeTermino = pendientes.filter((p) => p.fueraDeTermino).length;
  const mostrarFirma = puedeFirmar && laMasAntigua !== null;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Cierres" }]}
        title="Cierres diarios"
        description="Firma de cada jornada por el Director Técnico, en orden cronológico."
        actions={
          puedeVerReporte ? (
            <Link href="/cierres/reporte" className="btn btn-secondary">
              <FileBarChart className="size-4" aria-hidden />
              Reporte de cumplimiento
            </Link>
          ) : null
        }
      />

      <section aria-labelledby="pendientes-heading" className="mb-10">
        <div className="section-heading">
          <h2 id="pendientes-heading" className="flex items-center gap-2">
            Pendientes de firma <span className="tab-count">{pendientes.length}</span>
          </h2>
          {fueraDeTermino > 0 ? (
            <span className="text-xs font-medium text-red-700">
              {fueraDeTermino} fuera de término
            </span>
          ) : null}
        </div>

        {pendientes.length === 0 ? (
          <div className="list-panel">
            <EmptyState icon={<CircleCheck className="size-5" />} title="Todo firmado" description="No hay jornadas pendientes de firma." />
          </div>
        ) : (
          <div className={mostrarFirma ? "split-layout" : undefined}>
            <div className="list-panel min-w-0">
              <ul aria-label="Jornadas pendientes, de la más antigua a la más reciente">
                {pendientes.map((p) => (
                  <li key={p.fecha} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-100 px-4 py-3 last:border-b-0" data-proxima={p.esLaMasAntigua || undefined}>
                    <div className="min-w-[9rem]">
                      <p className="font-mono text-sm font-semibold text-zinc-900 tabular-nums">{formatFechaIso(p.fecha)}</p>
                      <p className="text-xs text-zinc-500">
                        {p.antiguedadDias === 0 ? "Hoy" : `Hace ${p.antiguedadDias} ${p.antiguedadDias === 1 ? "día" : "días"}`}
                      </p>
                    </div>
                    <dl className="flex flex-1 flex-wrap gap-x-6 gap-y-1 text-xs">
                      <div>
                        <dt className="text-zinc-500">Recetario</dt>
                        <dd className="font-mono text-sm text-zinc-900 tabular-nums">{p.cantidadRecetario}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Contralor</dt>
                        <dd className="font-mono text-sm text-zinc-900 tabular-nums">{p.cantidadContralor}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap items-center gap-2">
                      {p.esLaMasAntigua ? <ToneBadge tone="neutral">Siguiente a firmar</ToneBadge> : null}
                      <ToneBadge tone={p.fueraDeTermino ? "danger" : "success"}>{p.fueraDeTermino ? "Fuera de término" : "En término"}</ToneBadge>
                    </div>
                  </li>
                ))}
              </ul>
              {pendientes.length > 1 ? (
                <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">Las jornadas se firman en orden: primero la más antigua.</p>
              ) : null}
            </div>

            {mostrarFirma && laMasAntigua ? (
              <aside className="split-aside" aria-label="Firma de la jornada">
                <FirmarForm
                  fecha={laMasAntigua.fecha}
                  fueraDeTermino={laMasAntigua.fueraDeTermino}
                  esJornadaActual={esJornadaActual}
                  preparacionesIniciadas={preparaciones.map((p) => ({ id: p.id, descripcion: p.itemDescripcion ?? "Preparación sin descripción" }))}
                />
              </aside>
            ) : null}
          </div>
        )}
      </section>

      <section aria-labelledby="historial-heading" id="historial">
        <div className="section-heading">
          <h2 id="historial-heading">Historial</h2>
        </div>

        <FilterForm className="filter-bar mb-3" aria-label="Filtros del historial de cierres" hasActiveFilters={false}>
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
          <div className="filter-chips mb-4" role="group" aria-label="Filtros activos">
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
                    <Link href="/cierres#historial" scroll={false} className="btn btn-secondary">
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
                        <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums sm:table-cell">
                          {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(item.fechaFirma)}
                        </td>
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
      </section>
    </div>
  );
}
