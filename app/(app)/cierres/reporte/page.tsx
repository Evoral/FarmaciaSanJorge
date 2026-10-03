/** `/cierres/reporte` (FASE 10, M13a point 10.4). Reporte de cumplimiento de firma: fecha, fecha de firma, demora, fuera de término, motivo, DT. Filtros por rango de fechas; exportación CSV auditada. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FileBarChart, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { reporteCumplimiento } from "@/modules/cierres/application/reporte-cumplimiento";
import { MOTIVO_DEMORA_LABELS, type MotivoDemoraValue } from "@/modules/cierres/domain/motivo-demora";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToneBadge } from "@/shared/ui/status-badge";

interface ReporteCumplimientoPageProps {
  searchParams: Promise<{ fechaDesde?: string; fechaHasta?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function ReporteCumplimientoPage({ searchParams }: ReporteCumplimientoPageProps) {
  // Same session/permiso guard pattern other cierres pages use (e.g.
  // app/(app)/cierres/page.tsx) -- checked here BEFORE calling
  // `reporteCumplimiento` so a user without `cierres.reporte` gets a
  // friendly redirect instead of an uncaught AuthorizationError from the
  // underlying defineQuery.
  const session = await requireSession();
  if (!can(session, "cierres.reporte")) {
    redirect("/cierres");
  }

  const params = await searchParams;
  const items = await reporteCumplimiento({ fechaDesde: params.fechaDesde, fechaHasta: params.fechaHasta });

  function exportHref(): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    return `/api/cierres/reporte/csv?${qs.toString()}`;
  }

  function sinFiltroHref(param: "fechaDesde" | "fechaHasta"): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde && param !== "fechaDesde") qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta && param !== "fechaHasta") qs.set("fechaHasta", params.fechaHasta);
    const query = qs.toString();
    return query ? `/cierres/reporte?${query}` : "/cierres/reporte";
  }

  const hayFiltros = Boolean(params.fechaDesde || params.fechaHasta);
  // Summary of the rows already on screen (no extra query).
  const fueraDeTermino = items.filter((item) => item.fueraDeTermino).length;
  const enTermino = items.length - fueraDeTermino;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Cierres", href: "/cierres" }, { label: "Reporte de cumplimiento" }]}
        title="Reporte de cumplimiento de firma"
        description="Cuándo se firmó cada jornada, con su demora y el motivo cuando quedó fuera de término."
        actions={
          <a href={exportHref()} className="btn btn-secondary">
            <Download className="size-4" aria-hidden />
            Exportar CSV
          </a>
        }
      />

      <section aria-label="Filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros del reporte de cumplimiento" hasActiveFilters={false}>
          <div className="field">
            <span id="reporte-fecha-label" className="field-label">
              Jornada
            </span>
            <div className="range-field" role="group" aria-labelledby="reporte-fecha-label">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(items.length)}</span> {items.length === 1 ? "cierre" : "cierres"}
            </p>
            {items.length > 0 ? (
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <ToneBadge tone="success">{numberFormat.format(enTermino)} en término</ToneBadge>
                <ToneBadge tone={fueraDeTermino > 0 ? "warn" : "neutral"}>{numberFormat.format(fueraDeTermino)} fuera de término</ToneBadge>
              </p>
            ) : null}
          </div>

          {items.length === 0 ? (
            hayFiltros ? (
              <EmptyState icon={<SearchX className="size-5" />} title="Sin resultados" description="No hay cierres en ese rango de fechas." />
            ) : (
              <EmptyState icon={<FileBarChart className="size-5" />} title="Todavía no hay cierres firmados" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Jornada
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Firma
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Demora (días)
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Término
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Motivo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Director Técnico
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.fecha}>
                      <td className="px-3 py-2.5 font-mono font-semibold text-zinc-900 tabular-nums">{formatFechaIso(item.fecha)}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums sm:table-cell">
                        {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(item.fechaFirma)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${item.fueraDeTermino ? "font-semibold text-amber-700" : ""}`}>{item.demoraDias}</td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={item.fueraDeTermino ? "warn" : "success"}>{item.fueraDeTermino ? "Fuera" : "En término"}</ToneBadge>
                      </td>
                      <td className="hidden px-3 py-2.5 text-zinc-700 lg:table-cell">
                        {item.motivoDemora ? (
                          <>
                            {MOTIVO_DEMORA_LABELS[item.motivoDemora as MotivoDemoraValue] ?? item.motivoDemora}
                            {item.motivoDemoraDetalle ? <span className="block text-xs text-zinc-500">{item.motivoDemoraDetalle}</span> : null}
                          </>
                        ) : (
                          <span className="text-zinc-400">
                            -<span className="sr-only">Sin motivo</span>
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {item.directorTecnicoApellido}, {item.directorTecnicoNombre}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
