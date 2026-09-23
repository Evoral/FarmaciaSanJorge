/** `/stock/partidas?drogaId=...` (M07, FASE 5 point 5.2): partidas of one droga, with balances. */
import Link from "next/link";
import { listPartidasDroga } from "@/modules/stock/application/list-partidas-droga";

const PAGE_SIZE = 20;

interface PartidasPageProps {
  searchParams: Promise<{ drogaId?: string; soloConSaldo?: string; page?: string }>;
}

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(fecha);
}

export default async function PartidasPage({ searchParams }: PartidasPageProps) {
  const params = await searchParams;
  const drogaId = params.drogaId ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const soloConSaldo = params.soloConSaldo !== "0";

  if (!drogaId) {
    return (
      <div className="p-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Elegí una droga desde <Link href="/stock" className="underline">Stock</Link> para ver sus partidas.
        </p>
      </div>
    );
  }

  const result = await listPartidasDroga({ drogaId, soloConSaldo, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Partidas</h1>
        <Link href="/stock" className="text-sm underline">
          Volver a stock
        </Link>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de partidas">
        <input type="hidden" name="drogaId" value={drogaId} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="soloConSaldo" value="1" defaultChecked={soloConSaldo} />
          Solo con saldo disponible
        </label>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} partida{result.total === 1 ? "" : "s"} encontrada{result.total === 1 ? "" : "s"}.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Lote</th>
              <th scope="col" className="px-3 py-2 font-medium">Proveedor</th>
              <th scope="col" className="px-3 py-2 font-medium">Vencimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">Saldo</th>
              <th scope="col" className="px-3 py-2 font-medium">Costo unitario</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron partidas con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((partida) => (
                <tr key={partida.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/stock/partidas/${partida.id}`} className="font-medium underline-offset-2 hover:underline">
                      {partida.lote}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{partida.proveedorRazonSocial}</td>
                  <td className="px-3 py-2">{formatFecha(partida.fechaVencimiento)}</td>
                  <td className="px-3 py-2">
                    {partida.cantidadDisponible} / {partida.cantidadInicial}
                  </td>
                  <td className="px-3 py-2">{partida.costoUnitario}</td>
                  <td className="px-3 py-2">{partida.fechaApertura ? "Abierta" : "Cerrada"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de partidas" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={`/stock/partidas?drogaId=${drogaId}&page=${Math.max(1, page - 1)}`} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link
            href={`/stock/partidas?drogaId=${drogaId}&page=${Math.min(totalPages, page + 1)}`}
            aria-disabled={page >= totalPages}
            className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
