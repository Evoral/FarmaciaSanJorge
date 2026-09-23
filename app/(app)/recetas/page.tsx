/** `/recetas` (FASE 6 point 6.6): listado con filtros por estado/fecha/número, server-side. */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRecetas } from "@/modules/recetas/application/list-recetas";
import { ESTADOS_RECETA } from "@/modules/recetas/domain/receta";

const PAGE_SIZE = 20;

interface RecetasPageProps {
  searchParams: Promise<{ estado?: string; numero?: string; desde?: string; hasta?: string; page?: string }>;
}

export default async function RecetasPage({ searchParams }: RecetasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const estado = params.estado ?? "";

  const result = await listRecetas({
    estado: ESTADOS_RECETA.includes(estado as (typeof ESTADOS_RECETA)[number]) ? (estado as (typeof ESTADOS_RECETA)[number]) : undefined,
    numeroInterno: params.numero,
    desde: params.desde,
    hasta: params.hasta,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeCrear = can(session, "recetas.crear");
  const puedeFisica = can(session, "recetas.fisica.registrar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.estado) qs.set("estado", params.estado);
    if (params.numero) qs.set("numero", params.numero);
    if (params.desde) qs.set("desde", params.desde);
    if (params.hasta) qs.set("hasta", params.hasta);
    qs.set("page", String(targetPage));
    return `/recetas?${qs.toString()}`;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Recetas</h1>
        <div className="flex gap-3">
          {puedeFisica ? (
            <Link href="/recetas/pendientes-fisica" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
              Pendientes de receta física
            </Link>
          ) : null}
          {puedeCrear ? (
            <Link href="/recetas/nuevo" className="rounded bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
              Nueva receta
            </Link>
          ) : null}
        </div>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de recetas">
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={estado} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todos</option>
            {ESTADOS_RECETA.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="numero" className="text-sm font-medium">
            Nº interno
          </label>
          <input id="numero" name="numero" type="text" defaultValue={params.numero ?? ""} className="w-28 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            Desde
          </label>
          <input id="desde" name="desde" type="date" defaultValue={params.desde ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <input id="hasta" name="hasta" type="date" defaultValue={params.hasta ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
        <Link href="/recetas" className="text-sm underline">
          Limpiar filtros
        </Link>
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
        {result.total} receta{result.total === 1 ? "" : "s"} encontrada{result.total === 1 ? "" : "s"}.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Nº
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Paciente
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Médico
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Fecha prescripción
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Estado
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Receta física
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron recetas con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/recetas/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {r.numeroInterno}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.pacienteApellido}, {r.pacienteNombre}
                  </td>
                  <td className="px-3 py-2">
                    {r.medicoApellido}, {r.medicoNombre}
                  </td>
                  <td className="px-3 py-2">{r.fechaPrescripcion.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2">{r.estado}</td>
                  <td className="px-3 py-2">{r.recetaFisicaRecibida ? "Sí" : "No"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de recetas" className="mt-4 flex items-center gap-2 text-sm">
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
