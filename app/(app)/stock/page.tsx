/** `/stock` (M07, FASE 5 points 5.2/5.7): stock por droga + alertas. */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listStockDrogas } from "@/modules/stock/application/list-stock-drogas";
import { alertasStock } from "@/modules/stock/application/alertas-stock";

const PAGE_SIZE = 20;

interface StockPageProps {
  searchParams: Promise<{ q?: string; bajoMinimo?: string; page?: string }>;
}

export default async function StockPage({ searchParams }: StockPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const soloBajoMinimo = params.bajoMinimo === "1";

  const [stock, alertas] = await Promise.all([
    listStockDrogas({ search: params.q, soloBajoMinimo, page, pageSize: PAGE_SIZE }),
    alertasStock(),
  ]);

  const totalPages = Math.max(1, Math.ceil(stock.total / PAGE_SIZE));
  const puedeIngresar = can(session, "stock.partida.ingresar");
  const puedeAjustar = can(session, "stock.ajuste.registrar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.bajoMinimo) qs.set("bajoMinimo", params.bajoMinimo);
    qs.set("page", String(targetPage));
    return `/stock?${qs.toString()}`;
  }

  return (
    <div className="page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock</h1>
        <div className="flex gap-2">
          {puedeAjustar ? (
            <Link href="/stock/ajustes/nuevo" className="btn btn-secondary">
              Registrar ajuste
            </Link>
          ) : null}
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
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
              <p className="font-medium">Bajo stock mínimo</p>
              <p>{alertas.bajoMinimo.length} droga(s) por debajo del stock mínimo.</p>
            </div>
          ) : null}
          {alertas.porVencer.length > 0 ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
              <p className="font-medium">Próximas a vencer</p>
              <p>
                {alertas.porVencer.length} partida(s) vencen en los próximos {alertas.diasAlertaVencimiento} días.
              </p>
            </div>
          ) : null}
          {alertas.vencidasConSaldo.length > 0 ? (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
              <p className="font-medium">Vencidas con saldo</p>
              <p>{alertas.vencidasConSaldo.length} partida(s) vencidas todavía tienen saldo. Se sugiere un ajuste por vencimiento.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de stock">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar droga
          </label>
          <input id="q" name="q" type="search" defaultValue={params.q ?? ""} className="input" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="bajoMinimo" value="1" defaultChecked={soloBajoMinimo} />
          Solo bajo mínimo
        </label>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
      </form>

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
              <th scope="col" className="px-3 py-2 font-medium">Controlada</th>
            </tr>
          </thead>
          <tbody>
            {stock.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron drogas con estos filtros.
                </td>
              </tr>
            ) : (
              stock.items.map((item) => {
                const bajoMinimo = Number(item.stockDisponible) < Number(item.stockMinimo);
                return (
                  <tr key={item.drogaId}>
                    <td className="px-3 py-2">
                      <Link href={`/stock/partidas?drogaId=${item.drogaId}`} className="font-medium underline-offset-2 hover:underline">
                        {item.drogaNombre}
                      </Link>
                    </td>
                    <td className={`px-3 py-2 ${bajoMinimo ? "font-semibold text-red-600" : ""}`}>
                      {item.stockDisponible} {item.unidadSimbolo}
                    </td>
                    <td className="px-3 py-2">
                      {item.stockMinimo} {item.unidadSimbolo}
                    </td>
                    <td className="px-3 py-2">{item.esControlada ? "Sí" : "No"}</td>
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
