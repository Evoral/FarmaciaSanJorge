/** `/entregas` (FASE 11 points 11.1/11.2): recetas PREPARADA (listas para entregar) y ENVIADA_PEND_FIRMA (esperando firma). Paciente search goes through `EntregasBuscador` (POST Server Action, DP-24 -- never a URL/query string); the page-number pagination below carries no identifying data, so a plain GET `?page=` is fine (same distinction `modules/pacientes/ui/pacientes-buscador.tsx` documents). */
import { requireSession } from "@/shared/auth/session";
import { listEntregasPendientes } from "@/modules/entregas/application/list-entregas-pendientes";
import { EntregasBuscador } from "@/modules/entregas/ui/entregas-buscador";
import { PageHeader } from "@/shared/ui/page-header";
import { Pagination } from "@/shared/ui/pagination";

const PAGE_SIZE = 20;

interface EntregasPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function EntregasPage({ searchParams }: EntregasPageProps) {
  await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const result = await listEntregasPendientes({ page, pageSize: PAGE_SIZE });

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Entregas" }]}
        title="Entregas"
        description="Recetas preparadas para entregar y envíos a la espera de la firma recibida."
      />

      <EntregasBuscador itemsIniciales={result.items} totalInicial={result.total} />

      {result.total > PAGE_SIZE ? (
        <div className="list-panel mt-4 [&>.pagination]:border-t-0">
          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={(p) => `/entregas?page=${p}`} label="Paginación de entregas" />
        </div>
      ) : null}
    </div>
  );
}
