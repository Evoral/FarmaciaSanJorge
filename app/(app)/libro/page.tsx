/** `/libro` (FASE 9, M12 point 9.1). Consulta del libro recetario: filtros por rango de fechas/números, estado, texto paciente/médico, paginación. */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listAsientosRecetario } from "@/modules/libro/application/list-asientos-recetario";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";

const PAGE_SIZE = 25;

interface LibroPageProps {
  searchParams: Promise<{
    fechaDesde?: string;
    fechaHasta?: string;
    numeroDesde?: string;
    numeroHasta?: string;
    estado?: string;
    texto?: string;
    page?: string;
  }>;
}

export default async function LibroPage({ searchParams }: LibroPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const filtro = {
    fechaDesde: params.fechaDesde || undefined,
    fechaHasta: params.fechaHasta || undefined,
    numeroDesde: params.numeroDesde || undefined,
    numeroHasta: params.numeroHasta || undefined,
    estado: params.estado === "VIGENTE" || params.estado === "ANULADO" ? (params.estado as "VIGENTE" | "ANULADO") : undefined,
    texto: params.texto || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const result = await listAsientosRecetario(filtro);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeExportar = can(session, "libro.exportar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    if (params.numeroDesde) qs.set("numeroDesde", params.numeroDesde);
    if (params.numeroHasta) qs.set("numeroHasta", params.numeroHasta);
    if (params.estado) qs.set("estado", params.estado);
    if (params.texto) qs.set("texto", params.texto);
    qs.set("page", String(targetPage));
    return `/libro?${qs.toString()}`;
  }

  function exportHref(kind: "csv" | "pdf"): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    if (params.numeroDesde) qs.set("numeroDesde", params.numeroDesde);
    if (params.numeroHasta) qs.set("numeroHasta", params.numeroHasta);
    if (params.estado) qs.set("estado", params.estado);
    if (params.texto) qs.set("texto", params.texto);
    return `/api/libro/export/${kind}?${qs.toString()}`;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Libro recetario</h1>
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

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros del libro recetario">
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
        <div className="flex flex-col gap-1">
          <label htmlFor="numeroDesde" className="text-sm font-medium">
            Nº desde
          </label>
          <input id="numeroDesde" name="numeroDesde" type="number" min={1} defaultValue={params.numeroDesde ?? ""} className="w-24 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="numeroHasta" className="text-sm font-medium">
            Nº hasta
          </label>
          <input id="numeroHasta" name="numeroHasta" type="number" min={1} defaultValue={params.numeroHasta ?? ""} className="w-24 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todos</option>
            <option value="VIGENTE">Vigente</option>
            <option value="ANULADO">Anulado</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="texto" className="text-sm font-medium">
            Paciente / médico
          </label>
          <input id="texto" name="texto" type="search" defaultValue={params.texto ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
        <Link href="/libro" className="text-sm underline">
          Limpiar filtros
        </Link>
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} asiento{result.total === 1 ? "" : "s"} encontrado{result.total === 1 ? "" : "s"}.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Origen</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Médico</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron asientos con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((item) => {
                const estadoVisual = resolverEstadoVisualAsiento({
                  estado: item.estado,
                  anulacion: item.anulacion,
                  rectificativoNumeroCorrelativo: item.rectificativoNumeroCorrelativo,
                });
                return (
                  <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-3 py-2">
                      <Link href={`/libro/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                        {item.numeroCorrelativo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{item.fechaAsiento}</td>
                    <td className="px-3 py-2">{item.origen === "RECTIFICATIVO" ? `Rectifica Nº ${item.asientoOriginalNumeroCorrelativo}` : "Sistema"}</td>
                    <td className="px-3 py-2">{item.pacienteTexto}</td>
                    <td className="px-3 py-2">{item.medicoTexto}</td>
                    <td className={`px-3 py-2 ${estadoVisual.kind !== "VIGENTE" ? "text-amber-700 dark:text-amber-400" : ""}`}>{etiquetaEstadoVisual(estadoVisual)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación del libro recetario" className="mt-4 flex items-center gap-2 text-sm">
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

      <div className="mt-6 flex gap-4 text-sm">
        <Link href="/libro/integridad" className="underline">
          Verificar integridad de la cadena
        </Link>
        <Link href="/libro/contralor" className="underline">
          Libros contralor
        </Link>
        <Link href="/libro/historico" className="underline">
          Asientos históricos
        </Link>
      </div>
    </div>
  );
}
