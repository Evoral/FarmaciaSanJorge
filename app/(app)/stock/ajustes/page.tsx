/**
 * `/stock/ajustes` (M07): the registered ajustes/mermas (AJUSTE movements),
 * newest first, with search (droga or lote), motivo and jornada range
 * filters, all combined with AND and applied in SQL
 * (modules/stock/application/list-ajustes.ts). "Registrar ajuste" opens the
 * creation flow (`./nuevo`), which comes back here with `?registrado=1`;
 * that one-shot flag is never carried by the filter or pagination links.
 * Section guard: `app/(app)/stock/layout.tsx` (`stock.ver`).
 */
import Link from "next/link";
import { ChevronRight, CircleAlert, CircleCheck, ClipboardList, SearchX, SlidersHorizontal, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listAjustes } from "@/modules/stock/application/list-ajustes";
import { MOTIVOS_AJUSTE, MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { ajustesSearchParams, hayFiltrosAjustes, parseFiltrosAjustes, rangoAjustesInvalido, type FiltrosAjustes, type ParamsAjustes } from "@/modules/stock/domain/ajustes-listado";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { DrogaBuscador } from "@/modules/stock/ui/droga-buscador";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

interface AjustesPageProps {
  searchParams: Promise<ParamsAjustes & { page?: string; registrado?: string }>;
}

function formatFechaHora(fecha: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(fecha);
}

/** `2026-09-01` -> `01/09/2026` (filters are already validated ISO dates). */
function isoToDisplay(value: string): string {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function AjustesPage({ searchParams }: AjustesPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const filtros = parseFiltrosAjustes(params);
  // Checked here so an inverted range shows a message instead of the use case's ValidationError.
  const rangoInvalido = rangoAjustesInvalido(filtros);

  const [result, { catalogo }] = await Promise.all([
    rangoInvalido
      ? Promise.resolve({ items: [], total: 0, page, pageSize: PAGE_SIZE, zonaHoraria: "UTC" })
      : listAjustes({
          search: filtros.q,
          motivoAjuste: filtros.motivo,
          desde: filtros.desde,
          hasta: filtros.hasta,
          page,
          pageSize: PAGE_SIZE,
        }),
    getCatalogoUnidades(),
  ]);

  const puedeRegistrar = can(session, "stock.ajuste.registrar");
  const hayFiltros = hayFiltrosAjustes(filtros);

  function pageHref(targetPage: number): string {
    return `/stock/ajustes?${ajustesSearchParams(filtros, targetPage).toString()}`;
  }

  function hrefCon(cambios: Partial<FiltrosAjustes>): string {
    const query = ajustesSearchParams({ ...filtros, ...cambios }).toString();
    return query ? `/stock/ajustes?${query}` : "/stock/ajustes";
  }

  const chips: { key: keyof FiltrosAjustes; label: string; value: string }[] = [];
  if (filtros.q) chips.push({ key: "q", label: "Búsqueda", value: filtros.q });
  if (filtros.motivo) chips.push({ key: "motivo", label: "Motivo", value: MOTIVO_AJUSTE_LABELS[filtros.motivo] ?? filtros.motivo });
  if (filtros.desde) chips.push({ key: "desde", label: "Desde", value: isoToDisplay(filtros.desde) });
  if (filtros.hasta) chips.push({ key: "hasta", label: "Hasta", value: isoToDisplay(filtros.hasta) });

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: "Ajustes" }]}
        title="Ajustes"
        description="Ajustes y mermas registrados, del más reciente al más antiguo."
        actions={
          puedeRegistrar ? (
            <Link href="/stock/ajustes/nuevo" className="btn btn-primary">
              <SlidersHorizontal className="size-4" aria-hidden />
              Registrar ajuste
            </Link>
          ) : null
        }
      />

      {params.registrado === "1" ? (
        <div role="status" className="alert alert-success mb-4">
          <CircleCheck aria-hidden />
          <p>Ajuste registrado. Es la primera fila del listado.</p>
        </div>
      ) : null}

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de ajustes" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="q" value={filtros.q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <DrogaBuscador
              id="q-buscar"
              label="Buscar droga o lote"
              hideLabel
              placeholder="Buscar droga o lote"
              busquedaActual={filtros.q}
              alElegir={{ href: hrefCon({ q: undefined }), param: "q", valor: "nombre" }}
              alBuscar={{ href: hrefCon({ q: undefined }), param: "q", texto: "Buscar “{q}” (droga o lote)", textoSinBusqueda: "Ver todos los ajustes" }}
            />
          </div>
          <FilterDrawer activeCount={(filtros.motivo ? 1 : 0) + (filtros.desde ? 1 : 0) + (filtros.hasta ? 1 : 0)}>
            <div className="field">
              <label htmlFor="motivo" className="field-label">
                Motivo
              </label>
              <select id="motivo" name="motivo" defaultValue={filtros.motivo ?? ""} className="input">
                <option value="">Todos</option>
                {MOTIVOS_AJUSTE.map((motivo) => (
                  <option key={motivo} value={motivo}>
                    {MOTIVO_AJUSTE_LABELS[motivo]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span id="fecha-ajuste-label" className="field-label">
                Fecha
              </span>
              <div className="range-field" role="group" aria-labelledby="fecha-ajuste-label">
                <label htmlFor="desde" className="sr-only">
                  Desde
                </label>
                <DateInput id="desde" name="desde" defaultValue={filtros.desde ?? ""} />
                <span className="range-field-sep" aria-hidden>
                  a
                </span>
                <label htmlFor="hasta" className="sr-only">
                  Hasta
                </label>
                <DateInput id="hasta" name="hasta" defaultValue={filtros.hasta ?? ""} />
              </div>
            </div>
          </FilterDrawer>
        </FilterForm>

        {chips.length > 0 ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={hrefCon({ [chip.key]: undefined } as Partial<FiltrosAjustes>)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/stock/ajustes" scroll={false} className="btn btn-ghost btn-sm">
                Limpiar filtros
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {rangoInvalido ? (
        <div role="alert" className="alert alert-danger mb-4">
          <CircleAlert aria-hidden />
          <p>La fecha &quot;Desde&quot; no puede ser posterior a la fecha &quot;Hasta&quot;.</p>
        </div>
      ) : null}

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "ajuste" : "ajustes"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún ajuste coincide con los filtros aplicados."
                action={
                  <Link href="/stock/ajustes" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<ClipboardList className="size-5" />} title="Todavía no hay ajustes registrados" description="Las mermas, roturas y vencimientos que se descuentan del stock aparecen acá." />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Fecha
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Droga
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Cantidad
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Motivo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 xl:table-cell">
                      Observación
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Registrado / autorizado (DT)
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((ajuste) => (
                    <tr key={ajuste.id}>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatFechaHora(ajuste.registradoEn, result.zonaHoraria)}</td>
                      <td className="px-3 py-2.5">
                        <span className="block font-medium text-zinc-900">{ajuste.drogaNombre}</span>
                        <span className="block text-xs text-zinc-500">
                          Lote <span className="font-mono">{ajuste.lote}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">
                        <Cantidad valor={formatCantidad(ajuste.cantidad, { id: ajuste.unidadId, simbolo: ajuste.unidadSimbolo }, catalogo)} />
                      </td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">
                        <ToneBadge tone="neutral">{MOTIVO_AJUSTE_LABELS[ajuste.motivoAjuste] ?? ajuste.motivoAjuste}</ToneBadge>
                      </td>
                      <td className="hidden px-3 py-2.5 xl:table-cell">
                        {ajuste.observacion ? (
                          <span title={ajuste.observacion} className="block max-w-xs truncate text-zinc-700">
                            {ajuste.observacion}
                          </span>
                        ) : (
                          <span className="text-zinc-400">
                            -<span className="sr-only">Sin observación</span>
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs lg:table-cell">
                        <span className="block text-zinc-900">
                          {ajuste.registradoPorNombre} {ajuste.registradoPorApellido}
                        </span>
                        {ajuste.autorizadoPorNombre ? (
                          <span className="block text-zinc-500">
                            Autorizó {ajuste.autorizadoPorNombre} {ajuste.autorizadoPorApellido}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link
                          href={`/stock/partidas/${ajuste.partidaId}`}
                          aria-label={`Ver detalle de la partida ${ajuste.lote} de ${ajuste.drogaNombre}`}
                          className="btn btn-ghost btn-sm"
                        >
                          <span className="hidden sm:inline">Partida</span>
                          <ChevronRight className="size-3.5" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de ajustes" />
        </div>
      </div>
    </div>
  );
}
