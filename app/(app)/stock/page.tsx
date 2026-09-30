/**
 * `/stock` (M07, FASE 5 points 5.2/5.7): stock por droga + alertas.
 * Filters (all combined with AND, applied in SQL): name search, the
 * boolean filters grouped in the "Filtros" dropdown, and order.
 * "Unificar unidades" (`unidades=base`) is a display option, not a filter:
 * quantities in their magnitude's base unit instead of the readable auto
 * unit (shared/format/cantidad.ts). Each alert card links to the list with
 * its matching filter applied.
 */
import Link from "next/link";
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

  const totalPages = Math.max(1, Math.ceil(stock.total / PAGE_SIZE));
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

  /** An alert card shows exactly its filter's list (other filters cleared; the display option is kept). */
  function alertaHref(filtro: FiltroName): string {
    const qs = new URLSearchParams({ [filtro]: "1" });
    if (modo === "base") qs.set("unidades", "base");
    return `/stock?${qs.toString()}`;
  }

  const hasActiveFilters = Boolean(q || FILTROS.some((f) => activos[f.name]));
  const cardClass = "block rounded border p-3 text-sm transition-colors";

  return (
    <div className="page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock</h1>
        <div className="flex gap-2">
          {puedeIngresar ? (
            <Link href="/stock/ingresar" className="btn btn-primary">
              Ingresar partida
            </Link>
          ) : null}
        </div>
      </div>

      {alertas.bajoMinimo.length > 0 || alertas.porVencer.length > 0 || alertas.vencidasConSaldo.length > 0 ? (
        <section aria-label="Alertas de stock" className="mb-6 grid gap-3 sm:grid-cols-3">
          {alertas.bajoMinimo.length > 0 ? (
            <Link
              href={alertaHref("bajoMinimo")}
              aria-current={activos.bajoMinimo ? "true" : undefined}
              className={`${cardClass} border-amber-300 bg-amber-50 hover:border-amber-500 dark:border-amber-800 dark:bg-amber-950`}
            >
              <span className="block font-medium">Bajo stock mínimo</span>
              <span className="block">{alertas.bajoMinimo.length} droga(s) por debajo del stock mínimo.</span>
            </Link>
          ) : null}
          {alertas.porVencer.length > 0 ? (
            <Link
              href={alertaHref("porVencer")}
              aria-current={activos.porVencer ? "true" : undefined}
              className={`${cardClass} border-amber-300 bg-amber-50 hover:border-amber-500 dark:border-amber-800 dark:bg-amber-950`}
            >
              <span className="block font-medium">Próximas a vencer</span>
              <span className="block">
                {alertas.porVencer.length} partida(s) vencen en los próximos {alertas.diasAlertaVencimiento} días.
              </span>
            </Link>
          ) : null}
          {alertas.vencidasConSaldo.length > 0 ? (
            <Link
              href={alertaHref("vencidas")}
              aria-current={activos.vencidas ? "true" : undefined}
              className={`${cardClass} border-red-300 bg-red-50 hover:border-red-500 dark:border-red-800 dark:bg-red-950`}
            >
              <span className="block font-medium">Vencidas con saldo</span>
              <span className="block">
                {alertas.vencidasConSaldo.length} partida(s) vencidas todavía tienen saldo. Se sugiere un ajuste por vencimiento.
              </span>
            </Link>
          ) : null}
        </section>
      ) : null}

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de stock" hasActiveFilters={hasActiveFilters}>
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar droga
          </label>
          <input id="q" name="q" type="search" defaultValue={q ?? ""} className="input" />
        </div>
        <FilterMultiSelect options={FILTROS.map((f) => ({ name: f.name, label: f.label, checked: activos[f.name] }))} />
        <div className="flex flex-col gap-1">
          <label htmlFor="orden" className="text-sm font-medium">
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
      </FilterForm>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {stock.total} droga{stock.total === 1 ? "" : "s"} encontrada{stock.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Droga</th>
              <th scope="col" className="px-3 py-2 font-medium">Stock disponible</th>
              <th scope="col" className="px-3 py-2 font-medium">Stock mínimo</th>
              <th scope="col" className="px-3 py-2 font-medium">Próximo vencimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {stock.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron drogas con estos filtros.
                </td>
              </tr>
            ) : (
              stock.items.map((item) => {
                const [disponible, minimo] = formatCantidadesFila([item.stockDisponible, item.stockMinimo], { id: item.unidadId, simbolo: item.unidadSimbolo }, catalogo, modo);
                return (
                  <tr key={item.drogaId}>
                    <td className="px-3 py-2 font-medium">{item.drogaNombre}</td>
                    <td className={`px-3 py-2 ${item.bajoMinimo ? "font-semibold text-red-600" : ""}`}>
                      <Cantidad valor={disponible!} />
                    </td>
                    <td className="px-3 py-2">
                      <Cantidad valor={minimo!} />
                    </td>
                    <td className="px-3 py-2">{item.proximoVencimiento ? formatFecha(item.proximoVencimiento) : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/stock/partidas?drogaId=${item.drogaId}${modo === "base" ? "&unidades=base" : ""}`}
                        aria-label={`Ver detalle de ${item.drogaNombre}`}
                        className="whitespace-nowrap text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        Ver detalle →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de stock" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link href={pageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}>
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
