/**
 * `/partidas` (openspec/specs/historial-partidas/spec.md): every partida of the
 * tenant across all drogas (insumos included), agotadas included -- a history
 * to find a lote, its proveedor and its estado. Newest ingreso first.
 * Filters, all in the URL: droga (autocomplete, `drogaId`), lote (`q`),
 * proveedor (`proveedorId`), fecha de ingreso (`desde`/`hasta`), "Solo con
 * saldo" (`saldo=1`), "Solo vencidas" (`vencidas=1`); `unidades=base` is the
 * same display option as `/stock`'s "Unificar unidades".
 * Partida management starts here: "Nuevo ingreso" (`/partidas/ingresar`,
 * `stock.partida.ingresar`) lives in this header, not on `/stock`.
 * Section guard: `app/(app)/stock/layout.tsx` (`stock.ver`).
 */
import Link from "next/link";
import { ChevronRight, CircleAlert, History, PackagePlus, SearchX } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listPartidas } from "@/modules/stock/application/list-partidas";
import { esFechaIso } from "@/modules/stock/domain/ajustes-listado";
import { estadoVencimientoPartida } from "@/modules/stock/domain/vencimiento-partida";
import { KardexDrogaFiltro } from "@/modules/stock/ui/kardex-droga-filtro";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidadesFila, type ModoCantidad } from "@/shared/format/cantidad";
import { formatFecha } from "@/shared/format/fecha";
import { Cantidad } from "@/shared/ui/cantidad";
import { DateInput } from "@/shared/ui/date-input";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterMultiSelect } from "@/shared/ui/filter-multi-select";
import { SearchField } from "@/shared/ui/search-field";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { StatusBadge, ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;
const BASE_PATH = "/partidas";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HistorialPartidasPageProps {
  searchParams: Promise<{
    drogaId?: string;
    proveedorId?: string;
    q?: string;
    desde?: string;
    hasta?: string;
    saldo?: string;
    vencidas?: string;
    unidades?: string;
    page?: string;
  }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function HistorialPartidasPage({ searchParams }: HistorialPartidasPageProps) {
  const session = await requireSession();
  const puedeIngresar = can(session, "stock.partida.ingresar");
  const params = await searchParams;
  const drogaId = params.drogaId && UUID_PATTERN.test(params.drogaId) ? params.drogaId : "";
  const proveedorId = params.proveedorId && UUID_PATTERN.test(params.proveedorId) ? params.proveedorId : "";
  const q = params.q?.trim().slice(0, 100) ?? "";
  const desde = params.desde && esFechaIso(params.desde) ? params.desde : "";
  const hasta = params.hasta && esFechaIso(params.hasta) ? params.hasta : "";
  const soloConSaldo = params.saldo === "1";
  const soloVencidas = params.vencidas === "1";
  const modo: ModoCantidad = params.unidades === "base" ? "base" : "auto";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // Checked here so an inverted range shows a message instead of the use case's ValidationError.
  const rangoInvalido = Boolean(desde && hasta && desde > hasta);

  const [result, { catalogo }] = await Promise.all([
    listPartidas({
      drogaId: drogaId || undefined,
      proveedorId: proveedorId || undefined,
      lote: q || undefined,
      // An inverted range is dropped (the alert below explains it) so the page still lists something.
      desde: rangoInvalido ? undefined : desde || undefined,
      hasta: rangoInvalido ? undefined : hasta || undefined,
      soloConSaldo,
      soloVencidas,
      page,
      pageSize: PAGE_SIZE,
    }),
    getCatalogoUnidades(),
  ]);

  /** The normalized filters as a query string, plus `page` when given. */
  function query(targetPage?: number): string {
    const qs = new URLSearchParams();
    if (drogaId) qs.set("drogaId", drogaId);
    if (q) qs.set("q", q);
    if (proveedorId) qs.set("proveedorId", proveedorId);
    if (desde) qs.set("desde", desde);
    if (hasta) qs.set("hasta", hasta);
    if (soloConSaldo) qs.set("saldo", "1");
    if (soloVencidas) qs.set("vencidas", "1");
    if (modo === "base") qs.set("unidades", "base");
    if (targetPage !== undefined) qs.set("page", String(targetPage));
    return qs.toString();
  }

  function pageHref(targetPage: number): string {
    return `${BASE_PATH}?${query(targetPage)}`;
  }

  const filtrosHref = query() ? `${BASE_PATH}?${query()}` : BASE_PATH;
  const drogaFiltrada = drogaId ? { id: drogaId, nombre: result.droga?.nombre ?? "Droga seleccionada" } : null;
  const hayFiltrosForm = Boolean(q || proveedorId || desde || hasta || soloConSaldo || soloVencidas);
  const hayFiltros = hayFiltrosForm || Boolean(drogaId);

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: "Partidas" }]}
        title="Partidas"
        description="Historial de todas las partidas ingresadas, incluidas las agotadas."
        actions={
          puedeIngresar ? (
            <Link href="/partidas/ingresar" className="btn btn-primary">
              <PackagePlus className="size-4" aria-hidden />
              Nuevo ingreso
            </Link>
          ) : null
        }
      />

      <section aria-label="Filtros" className="mb-4">
        <div className="filter-bar">
          <div className="w-full min-w-0 md:w-80 md:flex-none">
            <KardexDrogaFiltro href={filtrosHref} seleccion={drogaFiltrada} />
          </div>
          <FilterForm className="flex w-full min-w-0 flex-wrap items-center gap-2.5 md:w-auto md:flex-1 md:items-end md:gap-3" aria-label="Filtros de partidas" hasActiveFilters={hayFiltrosForm}>
            {/* The droga is chosen in the autocomplete; this keeps it while the other filters change. */}
            <input type="hidden" name="drogaId" value={drogaId} />
            <SearchField id="q" name="q" label="Lote" hideLabel defaultValue={q} placeholder="Buscar lote" className="min-w-[11rem] flex-1 md:w-56 md:flex-none" />
            <FilterDrawer activeCount={(proveedorId ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0) + (soloConSaldo ? 1 : 0) + (soloVencidas ? 1 : 0)}>
              <div className="field">
                <label htmlFor="proveedorId" className="field-label">
                  Proveedor
                </label>
                <select id="proveedorId" name="proveedorId" defaultValue={proveedorId} className="input">
                  <option value="">Todos</option>
                  {result.proveedores.map((proveedor) => (
                    <option key={proveedor.id} value={proveedor.id}>
                      {proveedor.razonSocial}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span id="fecha-ingreso-label" className="field-label">
                  Fecha de ingreso
                </span>
                <div className="range-field" role="group" aria-labelledby="fecha-ingreso-label">
                  <label htmlFor="desde" className="sr-only">
                    Desde
                  </label>
                  <DateInput id="desde" name="desde" defaultValue={desde} />
                  <span className="range-field-sep" aria-hidden>
                    a
                  </span>
                  <label htmlFor="hasta" className="sr-only">
                    Hasta
                  </label>
                  <DateInput id="hasta" name="hasta" defaultValue={hasta} />
                </div>
              </div>
              <FilterMultiSelect
                options={[
                  { name: "saldo", label: "Solo con saldo", checked: soloConSaldo },
                  { name: "vencidas", label: "Solo vencidas", checked: soloVencidas },
                ]}
              />
              <label className="toggle-switch">
                <input type="checkbox" role="switch" name="unidades" value="base" defaultChecked={modo === "base"} data-preserve-on-clear="" />
                Unificar unidades
              </label>
            </FilterDrawer>
          </FilterForm>
        </div>
      </section>

      {rangoInvalido ? (
        <div role="alert" className="alert alert-danger mb-4">
          <CircleAlert aria-hidden />
          <p>La fecha &quot;Desde&quot; no puede ser posterior a la fecha &quot;Hasta&quot;. Se muestran las partidas sin filtrar por fecha.</p>
        </div>
      ) : null}

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
                  <Link href={BASE_PATH} scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<History className="size-5" />}
                title="Todavía no hay partidas"
                description="Las partidas aparecen acá cuando se ingresa stock."
                action={
                  puedeIngresar ? (
                    <Link href="/partidas/ingresar" className="btn btn-primary">
                      <PackagePlus className="size-4" aria-hidden />
                      Nuevo ingreso
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
                    <th scope="col" className="px-2.5 py-2 sm:px-3">
                      Lote
                    </th>
                    <th scope="col" className="hidden px-2 py-2 sm:table-cell sm:px-3">
                      Droga
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Proveedor
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Ingreso
                    </th>
                    <th scope="col" className="hidden px-2 py-2 sm:table-cell sm:px-3">
                      Vencimiento
                    </th>
                    <th scope="col" className="px-2.5 py-2 text-right sm:px-3">
                      Saldo <span className="hidden sm:inline">/ Inicial</span>
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Estado
                    </th>
                    <th scope="col" className="px-2 py-2 sm:px-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((partida) => {
                    const [disponible, inicial] = formatCantidadesFila(
                      [partida.cantidadDisponible, partida.cantidadInicial],
                      { id: partida.unidadBaseId, simbolo: partida.unidadBaseSimbolo },
                      catalogo,
                      modo,
                    );
                    const vencimiento = estadoVencimientoPartida(
                      partida.fechaVencimientoVigente ? partida.fechaVencimientoVigente.toISOString().slice(0, 10) : null,
                      result.jornadaActual,
                      result.diasAlertaVencimiento,
                    );
                    const conSaldo = partida.cantidadDisponible !== "0";
                    const reanalizada = partida.fechaVencimientoVigente?.getTime() !== partida.fechaVencimiento?.getTime();
                    return (
                      <tr key={partida.id}>
                        <td className="px-2.5 py-2.5 sm:px-3">
                          <Link href={`/partidas/${partida.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                            {partida.lote}
                          </Link>
                          <span className="mt-0.5 block font-medium text-zinc-800 sm:hidden">
                            {partida.drogaNombre}
                          </span>
                          <span className="block text-xs text-zinc-500 md:hidden">
                            {partida.proveedorRazonSocial}
                            <span className="sm:hidden">
                              {" · "}
                              {partida.fechaVencimientoVigente ? <span className="tabular-nums">Vto. {formatFecha(partida.fechaVencimientoVigente)}</span> : "No vence"}
                            </span>
                          </span>
                        </td>
                        <td className="hidden px-2 py-2.5 sm:table-cell sm:px-3">
                          <Link href={`/partidas?drogaId=${partida.drogaId}`} className="underline-offset-2 hover:underline">
                            {partida.drogaNombre}
                          </Link>
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">{partida.proveedorRazonSocial}</td>
                        {/* fecha_ingreso is a timestamptz: shown as the farmacia's own calendar day. */}
                        <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums sm:table-cell">{formatFecha(partida.fechaIngreso, result.zonaHoraria)}</td>
                        {/* The vencimiento VIGENTE (openspec/specs/reanalisis-partida/spec.md): a reanálisis may have moved it from the original date. */}
                        <td className="hidden whitespace-nowrap px-2 py-2.5 tabular-nums sm:table-cell sm:px-3">
                          {partida.fechaVencimientoVigente ? formatFecha(partida.fechaVencimientoVigente) : "No vence"}
                          {reanalizada ? (
                            <span className="block text-xs text-zinc-500" title={partida.fechaVencimiento ? `Vencimiento original: ${formatFecha(partida.fechaVencimiento)}` : undefined}>
                              Reanalizada
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-2.5 text-right font-mono tabular-nums sm:px-3">
                          {disponible && inicial ? (
                            <>
                              <span className="font-medium text-zinc-900">
                                <Cantidad valor={disponible} />
                              </span>
                              <span className="hidden text-zinc-400 sm:inline"> / </span>
                              <span className="block text-xs text-zinc-500 sm:inline sm:text-[length:inherit]">
                                <span className="font-sans sm:hidden">de </span>
                                <Cantidad valor={inicial} />
                              </span>
                            </>
                          ) : (
                            `${partida.cantidadDisponible} / ${partida.cantidadInicial}`
                          )}
                        </td>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          <span className="flex flex-wrap gap-1">
                            {conSaldo && (vencimiento === "VENCIDA" || vencimiento === "POR_VENCER") ? <StatusBadge estado={vencimiento} /> : null}
                            {conSaldo ? null : <StatusBadge estado="AGOTADA" />}
                            <ToneBadge tone="neutral">{partida.fechaApertura ? "Abierta" : "Cerrada"}</ToneBadge>
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right sm:px-3">
                          <Link href={`/partidas/${partida.id}`} aria-label={`Ver la partida ${partida.lote}`} className="btn btn-ghost btn-sm btn-icon">
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

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de partidas" />
        </div>
      </div>
    </div>
  );
}
