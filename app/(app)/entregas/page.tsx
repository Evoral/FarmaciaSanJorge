/** `/entregas` (FASE 11 points 11.1/11.2): recetas PREPARADA/LISTA_PARA_RETIRAR (listas para entregar) y ENVIADA_PEND_FIRMA (esperando firma). Paciente search goes through `EntregasBuscador` (POST Server Action, DP-24 -- never a URL/query string); the page-number pagination below carries no identifying data, so a plain GET `?page=` is fine (same distinction `modules/pacientes/ui/pacientes-buscador.tsx` documents). */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listEntregasPendientes } from "@/modules/entregas/application/list-entregas-pendientes";
import { EntregasBuscador } from "@/modules/entregas/ui/entregas-buscador";

const PAGE_SIZE = 20;

interface EntregasPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function EntregasPage({ searchParams }: EntregasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const result = await listEntregasPendientes({ page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Entregas</h1>
        {can(session, "regularizacion.ver") ? (
          <Link href="/regularizacion" className="text-sm underline">
            Ver regularización
          </Link>
        ) : null}
      </div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Recetas listas para entregar (preparadas o marcadas &quot;lista para retirar&quot;) y envíos a la espera de la firma recibida.
      </p>

      <EntregasBuscador itemsIniciales={result.items} totalInicial={result.total} />

      {totalPages > 1 ? (
        <nav aria-label="Paginación de entregas" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={`/entregas?page=${Math.max(1, page - 1)}`} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link href={`/entregas?page=${Math.min(totalPages, page + 1)}`} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}>
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
