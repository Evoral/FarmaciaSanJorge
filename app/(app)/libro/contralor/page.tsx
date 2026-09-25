/** `/libro/contralor` (FASE 9, M12 point 9.4, DP-33; export buttons added FASE 13 point 13.3). Consulta de los libros contralor (psicotrópicos / estupefacientes). */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listContralor } from "@/modules/libro/application/list-contralor";

const PAGE_SIZE = 25;

interface ContralorPageProps {
  searchParams: Promise<{ tipoLibro?: string; drogaId?: string; fechaDesde?: string; fechaHasta?: string; page?: string }>;
}

const TIPO_MOVIMIENTO_LABELS: Record<string, string> = {
  APERTURA: "Apertura",
  INGRESO: "Ingreso",
  EGRESO: "Egreso",
  AJUSTE: "Ajuste",
};

export default async function ContralorPage({ searchParams }: ContralorPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const tipoLibro = params.tipoLibro === "PSICOTROPICO" || params.tipoLibro === "ESTUPEFACIENTE" ? params.tipoLibro : undefined;

  const result = await listContralor({
    tipoLibro,
    drogaId: params.drogaId || undefined,
    fechaDesde: params.fechaDesde || undefined,
    fechaHasta: params.fechaHasta || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeExportar = can(session, "libro.exportar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.tipoLibro) qs.set("tipoLibro", params.tipoLibro);
    if (params.drogaId) qs.set("drogaId", params.drogaId);
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    qs.set("page", String(targetPage));
    return `/libro/contralor?${qs.toString()}`;
  }

  function exportHref(kind: "csv" | "pdf"): string {
    const qs = new URLSearchParams();
    if (params.tipoLibro) qs.set("tipoLibro", params.tipoLibro);
    if (params.drogaId) qs.set("drogaId", params.drogaId);
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    return `/api/libro/export/contralor/${kind}?${qs.toString()}`;
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link href="/libro" className="text-sm underline">
          ← Volver al libro recetario
        </Link>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Libros contralor</h1>
        {puedeExportar ? (
          <div className="flex gap-2">
            <a href={exportHref("csv")} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
              Exportar CSV
            </a>
            <a href={exportHref("pdf")} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
              Exportar PDF
            </a>
          </div>
        ) : null}
      </div>

      {result.fechaActivacionContralor === null ? (
        <p className="mb-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          Libros contralor llevados en forma manual: este tenant no activó el contralor digital, así que el sistema no genera asientos.
        </p>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de libros contralor">
        <div className="flex flex-col gap-1">
          <label htmlFor="tipoLibro" className="text-sm font-medium">
            Libro
          </label>
          <select id="tipoLibro" name="tipoLibro" defaultValue={params.tipoLibro ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todos</option>
            <option value="PSICOTROPICO">Psicotrópicos</option>
            <option value="ESTUPEFACIENTE">Estupefacientes</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fechaDesde" className="text-sm font-medium">
            Desde
          </label>
          <input id="fechaDesde" name="fechaDesde" type="date" defaultValue={params.fechaDesde ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fechaHasta" className="text-sm font-medium">
            Hasta
          </label>
          <input id="fechaHasta" name="fechaHasta" type="date" defaultValue={params.fechaHasta ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
      </form>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Movimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">Droga</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Saldo anterior</th>
              <th scope="col" className="px-3 py-2 font-medium">Saldo posterior</th>
              <th scope="col" className="px-3 py-2 font-medium">Vale</th>
              <th scope="col" className="px-3 py-2 font-medium">Asiento recetario</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron asientos con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">{item.numeroCorrelativo}</td>
                  <td className="px-3 py-2">{item.fechaAsiento}</td>
                  <td className="px-3 py-2">{TIPO_MOVIMIENTO_LABELS[item.tipoMovimiento] ?? item.tipoMovimiento}</td>
                  <td className="px-3 py-2">{item.drogaDescripcion}</td>
                  <td className="px-3 py-2">{item.cantidad} {item.unidadSimbolo}</td>
                  <td className="px-3 py-2">{item.saldoAnterior}</td>
                  <td className="px-3 py-2">{item.saldoPosterior}</td>
                  <td className="px-3 py-2">{item.numeroValeAdquisicion ?? "—"}</td>
                  <td className="px-3 py-2">
                    {item.asientoRecetarioId ? (
                      <Link href={`/libro/${item.asientoRecetarioId}`} className="underline">
                        Nº {item.asientoRecetarioNumero}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de libros contralor" className="mt-4 flex items-center gap-2 text-sm">
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
