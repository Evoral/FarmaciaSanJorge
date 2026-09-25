/** `/archivo` (FASE 12, M15 points 12.1/12.2). Listado paginado con filtros por estado/período + badge de plazo cumplido. */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listLotesArchivo } from "@/modules/archivo/application/list-lotes";
import { ESTADOS_LOTE_ARCHIVO, ESTADO_LOTE_ARCHIVO_LABELS, type EstadoLoteArchivoValue } from "@/modules/archivo/domain/lote-archivo";
import { ActualizarPlazosButton } from "@/modules/archivo/ui/actualizar-plazos-button";

const PAGE_SIZE = 20;

interface ArchivoPageProps {
  searchParams: Promise<{ estado?: string; periodoDesde?: string; periodoHasta?: string; page?: string }>;
}

function esEstadoValido(value: string): value is EstadoLoteArchivoValue {
  return (ESTADOS_LOTE_ARCHIVO as readonly string[]).includes(value);
}

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

  const totalPages = Math.max(1, Math.ceil(resultado.total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (estado) qs.set("estado", estado);
    if (params.periodoDesde) qs.set("periodoDesde", params.periodoDesde);
    if (params.periodoHasta) qs.set("periodoHasta", params.periodoHasta);
    qs.set("page", String(targetPage));
    return `/archivo?${qs.toString()}`;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Archivo de recetas</h1>
        <div className="flex items-center gap-3">
          {puedeConformar ? <ActualizarPlazosButton /> : null}
          {puedeConformar ? (
            <Link href="/archivo/nuevo" className="rounded bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
              Conformar lote
            </Link>
          ) : null}
        </div>
      </div>

      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Se destruyen solo las recetas en papel; los registros digitales se conservan siempre.
      </p>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros del archivo">
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={estado ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todos</option>
            {ESTADOS_LOTE_ARCHIVO.map((value) => (
              <option key={value} value={value}>
                {ESTADO_LOTE_ARCHIVO_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="periodoDesde" className="text-sm font-medium">
            Período desde
          </label>
          <input id="periodoDesde" name="periodoDesde" type="date" defaultValue={params.periodoDesde ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="periodoHasta" className="text-sm font-medium">
            Período hasta
          </label>
          <input id="periodoHasta" name="periodoHasta" type="date" defaultValue={params.periodoHasta ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
        <Link href="/archivo" className="text-sm underline">
          Limpiar filtros
        </Link>
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {resultado.total} lote{resultado.total === 1 ? "" : "s"} encontrado{resultado.total === 1 ? "" : "s"}.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Período</th>
              <th scope="col" className="px-3 py-2 font-medium">Ubicación</th>
              <th scope="col" className="px-3 py-2 font-medium">Controladas</th>
              <th scope="col" className="px-3 py-2 font-medium">Vencimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {resultado.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron lotes con estos filtros.
                </td>
              </tr>
            ) : (
              resultado.items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/archivo/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                      Lote Nº {item.numero}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{item.periodoDesde} — {item.periodoHasta}</td>
                  <td className="px-3 py-2">{item.ubicacion}</td>
                  <td className="px-3 py-2">{item.incluyeControladas ? "Sí" : "No"}</td>
                  <td className="px-3 py-2">
                    {item.vencimiento}
                    {item.plazoCumplido && item.estado === "EN_ARCHIVO" ? (
                      <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">Plazo cumplido</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{ESTADO_LOTE_ARCHIVO_LABELS[item.estado]}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación del archivo" className="mt-4 flex items-center gap-2 text-sm">
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
