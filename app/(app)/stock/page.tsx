/**
 * `/stock` (M07, FASE 5 points 5.2/5.7): stock por droga + alertas.
 * Filters (all combined with AND, applied in SQL): name search, the
 * boolean filters grouped in the "Filtros" dropdown, and order.
 * "Unificar unidades" (`unidades=base`) is a display option, not a filter:
 * quantities in their magnitude's base unit instead of the readable auto
 * unit (shared/format/cantidad.ts). Each alert tab links to the list with
 * its matching filter applied.
 */
import Link from "next/link";
import { ChevronRight, PackagePlus, PackageSearch, SearchX, SlidersHorizontal, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listStockDrogas } from "@/modules/stock/application/list-stock-drogas";
import { alertasStock } from "@/modules/stock/application/alertas-stock";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { ORDENES_STOCK_DROGAS, ORDEN_STOCK_DROGAS_LABELS, type OrdenStockDrogas } from "@/modules/stock/domain/partida";
import { formatCantidadesFila, type ModoCantidad } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterMultiSelect } from "@/shared/ui/filter-multi-select";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { DrogaBuscador } from "@/modules/stock/ui/droga-buscador";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusSummary } from "@/shared/ui/status-summary";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

/** Boolean filters: query param -> label (the "Filtros" dropdown). */
const FILTROS = [
  { name: "bajoMinimo", label: "Bajo mínimo" },
  { name: "sinStock", label: "Sin stock" },
  { name: "porVencer", label: "Con partidas por vencer" },
  { name: "vencidas", label: "Con partidas vencidas con saldo" },
  { name: "controladas", label: "Solo controladas" },
] as const;

type FiltroName = (typeof FILTROS)[number]["name"];

interface StockPageProps {
  searchParams: Promise<Partial<Record<FiltroName | "q" | "orden" | "unidades" | "page", string>>>;
}

function formatFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function StockPage({ searchParams }: StockPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const q = params.q?.trim() || undefined;
  const activos = Object.fromEntries(FILTROS.map((f) => [f.name, params[f.name] === "1"])) as Record<FiltroName, boolean>;
  const orden: OrdenStockDrogas = (ORDENES_STOCK_DROGAS as readonly string[]).includes(params.orden ?? "") ? (params.orden as OrdenStockDrogas) : "nombre";
  const modo: ModoCantidad = params.unidades === "base" ? "base" : "auto";

  const [stock, alertas, { catalogo }] = await Promise.all([
    listStockDrogas({
      search: q,
      soloBajoMinimo: activos.bajoMinimo,
      soloSinStock: activos.sinStock,
      conPartidasPorVencer: activos.porVencer,
      conPartidasVencidas: activos.vencidas,
      soloControladas: activos.controladas,
      orden,
      page,
      pageSize: PAGE_SIZE,
    }),
    alertasStock(),
    getCatalogoUnidades(),
  ]);

  const puedeIngresar = can(session, "stock.partida.ingresar");

  /** Current filters (normalized), without `page`. */
  const actuales = new URLSearchParams();
  if (q) actuales.set("q", q);
  for (const f of FILTROS) if (activos[f.name]) actuales.set(f.name, "1");
  if (orden !== "nombre") actuales.set("orden", orden);
  if (modo === "base") actuales.set("unidades", "base");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams(actuales);
    qs.set("page", String(targetPage));
    return `/stock?${qs.toString()}`;
  }

  /** An alert tab shows exactly its filter's list (other filters cleared; the display option is kept). */
  function alertaHref(filtro: FiltroName): string {
    const qs = new URLSearchParams({ [filtro]: "1" });
    if (modo === "base") qs.set("unidades", "base");
    return `/stock?${qs.toString()}`;
  }

  /** The current list without one filter (back to page 1). */
  function sinFiltroHref(param: string): string {
    const qs = new URLSearchParams(actuales);
    qs.delete(param);
    const query = qs.toString();
    return query ? `/stock?${query}` : "/stock";
  }

  /** No filters at all; the display options (orden, unidades) stay. */
  const sinFiltrosQs = new URLSearchParams();
  if (orden !== "nombre") sinFiltrosQs.set("orden", orden);
  if (modo === "base") sinFiltrosQs.set("unidades", "base");
  const sinFiltrosHref = sinFiltrosQs.toString() ? `/stock?${sinFiltrosQs.toString()}` : "/stock";

  const hasActiveFilters = Boolean(q || FILTROS.some((f) => activos[f.name]));
  const filtrosBooleanosActivos = FILTROS.filter((f) => activos[f.name]).length;
  const chips = [...(q ? [{ key: "q", label: "Búsqueda", value: q }] : []), ...FILTROS.filter((f) => activos[f.name]).map((f) => ({ key: f.name, label: f.label, value: undefined }))];

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock" }]}
        title="Stock"
        description="Existencias por droga, con alertas de stock mínimo y vencimientos."
        actions={
          <>
            <Link href="/stock/ajustes" className="btn btn-secondary">
              <SlidersHorizontal className="size-4" aria-hidden />
              Ajustes
            </Link>
            {puedeIngresar ? (
              <Link href="/stock/ingresar" className="btn btn-primary">
                <PackagePlus className="size-4" aria-hidden />
                Ingresar partida
              </Link>
            ) : null}
          </>
        }
      />

      <StatusSummary
        label="Alertas de stock"
        unit={["droga", "drogas"]}
        all={{ label: "Todas las drogas", href: sinFiltrosHref, active: !hasActiveFilters }}
        items={[
          { key: "bajoMinimo", label: "Bajo stock mínimo", count: alertas.bajoMinimo.length, href: alertaHref("bajoMinimo"), active: activos.bajoMinimo, tone: "warn" },
          {
            key: "porVencer",
            label: `Vencen en ${alertas.diasAlertaVencimiento} días`,
            count: alertas.porVencer.length,
            href: alertaHref("porVencer"),
            active: activos.porVencer,
            tone: "warn",
            unit: ["partida", "partidas"],
          },
          {
            key: "vencidas",
            label: "Vencidas con saldo",
            count: alertas.vencidasConSaldo.length,
            href: alertaHref("vencidas"),
            active: activos.vencidas,
            tone: "danger",
            unit: ["partida", "partidas"],
          },
        ]}
        note={
          alertas.vencidasConSaldo.length > 0
            ? `${numberFormat.format(alertas.vencidasConSaldo.length)} ${alertas.vencidasConSaldo.length === 1 ? "partida vencida todavía tiene" : "partidas vencidas todavía tienen"} saldo. Se sugiere un ajuste por vencimiento.`
            : undefined
        }
      />

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de stock" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="q" value={q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <DrogaBuscador
              id="q-buscar"
              label="Buscar droga"
              hideLabel
              placeholder="Buscar droga"
              busquedaActual={q}
              alElegir={{ href: modo === "base" ? "/stock/partidas?unidades=base" : "/stock/partidas", param: "drogaId", valor: "id" }}
              alBuscar={{ href: sinFiltroHref("q"), param: "q", texto: "Buscar “{q}” en la lista", textoSinBusqueda: "Ver todas las drogas" }}
            />
          </div>
          <FilterDrawer activeCount={filtrosBooleanosActivos}>
            <FilterMultiSelect options={FILTROS.map((f) => ({ name: f.name, label: f.label, checked: activos[f.name] }))} />
            <div className="field">
              <label htmlFor="orden" className="field-label">
                Ordenar por
              </label>
              <select id="orden" name="orden" defaultValue={orden === "nombre" ? "" : orden} className="input" data-preserve-on-clear="">
                {ORDENES_STOCK_DROGAS.map((o) => (
                  <option key={o} value={o === "nombre" ? "" : o}>
                    {ORDEN_STOCK_DROGAS_LABELS[o]}
                  </option>
                ))}
              </select>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" role="switch" name="unidades" value="base" defaultChecked={modo === "base"} data-preserve-on-clear="" />
              Unificar unidades
            </label>
          </FilterDrawer>
        </FilterForm>

        {chips.length > 0 ? (
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
              <Link href={sinFiltrosHref} scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(stock.total)}</span> {stock.total === 1 ? "droga" : "drogas"}
            </p>
            {modo === "base" ? <p className="text-xs">Cantidades en la unidad base de cada magnitud</p> : null}
          </div>

          {stock.items.length === 0 ? (
            stock.total > 0 ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Esta página no tiene resultados"
                description="Hay resultados, pero en páginas anteriores."
                action={
                  <Link href={pageHref(1)} className="btn btn-secondary">
                    Ir a la primera página
                  </Link>
                }
              />
            ) : hasActiveFilters ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ninguna droga coincide con los filtros aplicados."
                action={
                  <Link href={sinFiltrosHref} scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<PackageSearch className="size-5" />}
                title="Todavía no hay stock"
                description="Las drogas aparecen acá cuando se ingresa su primera partida."
                action={
                  puedeIngresar ? (
                    <Link href="/stock/ingresar" className="btn btn-primary">
                      <PackagePlus className="size-4" aria-hidden />
                      Ingresar partida
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
                      Droga
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Disponible
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">
                      Mínimo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Próximo vencimiento
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stock.items.map((item) => {
                    const [disponible, minimo] = formatCantidadesFila([item.stockDisponible, item.stockMinimo], { id: item.unidadId, simbolo: item.unidadSimbolo }, catalogo, modo);
                    const partidasHref = `/stock/partidas?drogaId=${item.drogaId}${modo === "base" ? "&unidades=base" : ""}`;
                    return (
                      <tr key={item.drogaId}>
                        <td className="px-3 py-2.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <Link href={partidasHref} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                              {item.drogaNombre}
                            </Link>
                            {item.bajoMinimo ? <ToneBadge tone="warn">Bajo mínimo</ToneBadge> : null}
                          </span>
                          {item.proximoVencimiento ? (
                            <span className="block text-xs text-zinc-500 tabular-nums md:hidden">Vence {formatFecha(item.proximoVencimiento)}</span>
                          ) : null}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${item.bajoMinimo ? "font-semibold text-red-700" : "text-zinc-900"}`}>
                          <Cantidad valor={disponible!} />
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-mono text-zinc-500 tabular-nums sm:table-cell">
                          <Cantidad valor={minimo!} />
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums md:table-cell">
                          {item.proximoVencimiento ? (
                            formatFecha(item.proximoVencimiento)
                          ) : (
                            <span className="text-zinc-400">
                              -<span className="sr-only">Sin vencimientos</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link href={partidasHref} aria-label={`Ver partidas de ${item.drogaNombre}`} className="btn btn-ghost btn-sm">
                            <span className="hidden sm:inline">Partidas</span>
                            <ChevronRight className="size-3.5" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={stock.total} hrefFor={pageHref} label="Paginación de stock" />
        </div>
      </div>
    </div>
  );
}
