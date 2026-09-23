/** `/recetas/pendientes-fisica` (FASE 6 point 6.6, INV-R10): recetas sin receta física recibida, ordenadas por antigüedad. Gated by the layout on `recetas.crear`; this page itself needs `recetas.fisica.registrar` (checked by the query too). */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRecetasPendientesFisica } from "@/modules/recetas/application/list-recetas-pendientes-fisica";

const PAGE_SIZE = 20;

interface PendientesFisicaPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function PendientesFisicaPage({ searchParams }: PendientesFisicaPageProps) {
  const session = await requireSession();
  if (!can(session, "recetas.fisica.registrar")) redirect("/recetas");

  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const result = await listRecetasPendientesFisica({ page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="p-6">
      <div className="mb-2">
        <Link href="/recetas" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>
      <h1 className="mb-1 text-xl font-semibold">Pendientes de receta física</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Recetas no anuladas que todavía no tienen registrada la recepción de la receta física (INV-R10), ordenadas de más a menos antiguas.
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
                Estado
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Antigüedad
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No hay recetas pendientes de receta física.
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
                  <td className="px-3 py-2">{r.estado}</td>
                  <td className="px-3 py-2">
                    {r.antiguedadDias} día{r.antiguedadDias === 1 ? "" : "s"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de pendientes de receta física" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={`/recetas/pendientes-fisica?page=${Math.max(1, page - 1)}`} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link href={`/recetas/pendientes-fisica?page=${Math.min(totalPages, page + 1)}`} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}>
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
