/** `/archivo` (FASE 12, M15 points 12.1/12.2). Listado paginado con filtros por estado/período + badge de plazo cumplido. */
import Link from "next/link";
import { Archive, ChevronRight, Info, PackagePlus, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listLotesArchivo } from "@/modules/archivo/application/list-lotes";
import { ESTADOS_LOTE_ARCHIVO, ESTADO_LOTE_ARCHIVO_LABELS, type EstadoLoteArchivoValue } from "@/modules/archivo/domain/lote-archivo";
import { ActualizarPlazosButton } from "@/modules/archivo/ui/actualizar-plazos-button";
import { tonoEstadoLote } from "@/modules/archivo/ui/estado-lote";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { TabNav } from "@/shared/ui/tab-nav";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

interface ArchivoPageProps {
  searchParams: Promise<{ estado?: string; periodoDesde?: string; periodoHasta?: string; page?: string }>;
}

function esEstadoValido(value: string): value is EstadoLoteArchivoValue {
  return (ESTADOS_LOTE_ARCHIVO as readonly string[]).includes(value);
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function ArchivoPage({ searchParams }: ArchivoPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const estado = params.estado && esEstadoValido(params.estado) ? params.estado : undefined;

  const puedeConformar = can(session, "archivo.lotes.gestionar");

  const resultado = await listLotesArchivo({
    estado,
    periodoDesde: params.periodoDesde,
    periodoHasta: params.periodoHasta,
    page,
    pageSize: PAGE_SIZE,
  });

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (estado) qs.set("estado", estado);
    if (params.periodoDesde) qs.set("periodoDesde", params.periodoDesde);
    if (params.periodoHasta) qs.set("periodoHasta", params.periodoHasta);
    qs.set("page", String(targetPage));
    return `/archivo?${qs.toString()}`;
  }

  /** The list with the estado replaced (or removed) and the período kept, back on page 1. */
  function estadoHref(nuevo: EstadoLoteArchivoValue | undefined): string {
    const qs = new URLSearchParams();
    if (nuevo) qs.set("estado", nuevo);
    if (params.periodoDesde) qs.set("periodoDesde", params.periodoDesde);
    if (params.periodoHasta) qs.set("periodoHasta", params.periodoHasta);
    const query = qs.toString();
    return query ? `/archivo?${query}` : "/archivo";
  }

  function sinPeriodoHref(param: "periodoDesde" | "periodoHasta"): string {
    const qs = new URLSearchParams();
    if (estado) qs.set("estado", estado);
    if (params.periodoDesde && param !== "periodoDesde") qs.set("periodoDesde", params.periodoDesde);
    if (params.periodoHasta && param !== "periodoHasta") qs.set("periodoHasta", params.periodoHasta);
    const query = qs.toString();
    return query ? `/archivo?${query}` : "/archivo";
  }

  const hayFiltros = Boolean(estado || params.periodoDesde || params.periodoHasta);

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Archivo" }]}
        title="Archivo de recetas"
        description="Lotes de recetas en papel, su plazo de conservación y su destrucción."
        actions={
          puedeConformar ? (
            <>
              <ActualizarPlazosButton />
              <Link href="/archivo/nuevo" className="btn btn-primary">
                <PackagePlus className="size-4" aria-hidden />
                Conformar lote
              </Link>
            </>
          ) : null
        }
      />

      <div role="note" className="alert alert-info mb-5">
        <Info aria-hidden />
        <p>Se destruyen solo las recetas en papel; los registros digitales se conservan siempre.</p>
      </div>

      <TabNav
        label="Filtrar por estado"
        items={[
          { key: "todos", label: "Todos", href: estadoHref(undefined), active: !estado },
          ...ESTADOS_LOTE_ARCHIVO.map((value) => ({ key: value, label: ESTADO_LOTE_ARCHIVO_LABELS[value], href: estadoHref(value), active: estado === value })),
        ]}
      />

      <section aria-label="Filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros del archivo" hasActiveFilters={false}>
          {/* The estado is chosen in the tabs above; this hidden field keeps it while the período changes. */}
          <input type="hidden" name="estado" value={estado ?? ""} />
          <div className="field">
            <span id="archivo-periodo-label" className="field-label">
              Período
            </span>
            <div className="range-field" role="group" aria-labelledby="archivo-periodo-label">
              <label htmlFor="periodoDesde" className="sr-only">
                Período desde
              </label>
              <DateInput id="periodoDesde" name="periodoDesde" defaultValue={params.periodoDesde ?? ""} />
              <span className="range-field-sep" aria-hidden>
                a
              </span>
              <label htmlFor="periodoHasta" className="sr-only">
                Período hasta
              </label>
              <DateInput id="periodoHasta" name="periodoHasta" defaultValue={params.periodoHasta ?? ""} />
            </div>
          </div>
        </FilterForm>

        {params.periodoDesde || params.periodoHasta ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {params.periodoDesde ? (
              <span className="chip">
                Desde: <strong>{formatFechaIso(params.periodoDesde)}</strong>
                <Link href={sinPeriodoHref("periodoDesde")} scroll={false} className="chip-remove" aria-label="Quitar filtro Desde">
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ) : null}
            {params.periodoHasta ? (
              <span className="chip">
                Hasta: <strong>{formatFechaIso(params.periodoHasta)}</strong>
                <Link href={sinPeriodoHref("periodoHasta")} scroll={false} className="chip-remove" aria-label="Quitar filtro Hasta">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(resultado.total)}</span> {resultado.total === 1 ? "lote" : "lotes"}
            </p>
          </div>

          {resultado.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún lote coincide con los filtros aplicados."
                action={
                  <Link href="/archivo" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<Archive className="size-5" />}
                title="Todavía no hay lotes"
                description="Conformá un lote con las recetas entregadas o anuladas de un período."
                action={
                  puedeConformar ? (
                    <Link href="/archivo/nuevo" className="btn btn-primary">
                      <PackagePlus className="size-4" aria-hidden />
                      Conformar lote
                    </Link>
                  ) : null
                }
              />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Lote
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Período
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Ubicación
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Vencimiento
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
                  {resultado.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/archivo/${item.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                          Nº {item.numero}
                        </Link>
                        {item.incluyeControladas ? (
                          <span className="mt-1 block">
                            <ToneBadge tone="neutral">Incluye controladas</ToneBadge>
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                        {formatFechaIso(item.periodoDesde)} <span className="text-zinc-400">a</span> {formatFechaIso(item.periodoHasta)}
                        <span className="block text-xs text-zinc-500 md:hidden">{item.ubicacion}</span>
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">{item.ubicacion}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums lg:table-cell">
                        {formatFechaIso(item.vencimiento)}
                        {item.plazoCumplido && item.estado === "EN_ARCHIVO" ? (
                          <span className="ml-2">
                            <ToneBadge tone="warn">Plazo cumplido</ToneBadge>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={tonoEstadoLote(item.estado)}>{ESTADO_LOTE_ARCHIVO_LABELS[item.estado]}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/archivo/${item.id}`} aria-label={`Ver el lote Nº ${item.numero}`} className="btn btn-ghost btn-sm btn-icon">
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={resultado.total} hrefFor={pageHref} label="Paginación del archivo" />
        </div>
      </div>
    </div>
  );
}
