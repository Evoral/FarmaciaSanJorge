/** `/catalogos/medicos` (M06, FASE 4 point 4.4). Search + vigente/baja filter, plain GET query params (médicos are NOT health data -- no DP-24 URL restriction). */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listMedicos } from "@/modules/medicos/application/list-medicos";
import { MedicoForm } from "@/modules/medicos/ui/medico-form";

const PAGE_SIZE = 20;

interface MedicosPageProps {
  searchParams: Promise<{ q?: string; estado?: string; page?: string; nuevo?: string }>;
}

export default async function MedicosPage({ searchParams }: MedicosPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const result = await listMedicos({ search: params.q, soloVigentes, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeCrear = can(session, "medicos.gestionar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/catalogos/medicos?${qs.toString()}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Médicos</h1>
        {puedeCrear ? (
          <Link href="/catalogos/medicos?nuevo=1" className="rounded bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
            Nuevo médico
          </Link>
        ) : null}
      </div>

      {puedeCrear && params.nuevo ? (
        <div className="mb-6">
          <MedicoForm mode="crear" disabled={!puedeCrear} />
        </div>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de búsqueda de médicos">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar
          </label>
          <input id="q" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Apellido o matrícula" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todos</option>
            <option value="vigente">Vigentes</option>
            <option value="baja">Dados de baja</option>
          </select>
        </div>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
        {params.q || params.estado ? (
          <Link href="/catalogos/medicos" className="text-sm underline">
            Limpiar filtros
          </Link>
        ) : null}
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} médico{result.total === 1 ? "" : "s"} encontrado{result.total === 1 ? "" : "s"}.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Apellido y nombre</th>
              <th scope="col" className="px-3 py-2 font-medium">Matrícula</th>
              <th scope="col" className="px-3 py-2 font-medium">Especialidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron médicos con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((medico) => (
                <tr key={medico.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/catalogos/medicos/${medico.id}`} className="font-medium underline-offset-2 hover:underline">
                      {medico.apellido}, {medico.nombre}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{medico.matricula}</td>
                  <td className="px-3 py-2">{medico.especialidad ?? "—"}</td>
                  <td className="px-3 py-2">{medico.fechaBaja ? "Baja" : "Vigente"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de médicos" className="mt-4 flex items-center gap-2 text-sm">
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
