/**
 * `/stock/ajustes` (M07): the registered ajustes/mermas. The list itself is
 * `modules/stock/ui/ajustes-listado.tsx`, shared with the "Pendientes del
 * DT" section's `/cierres/ajustes` tab.
 * Section guard: `app/(app)/stock/layout.tsx` (`stock.ver`).
 */
import type { ParamsAjustes } from "@/modules/stock/domain/ajustes-listado";
import { AjustesListado } from "@/modules/stock/ui/ajustes-listado";

interface AjustesPageProps {
  searchParams: Promise<ParamsAjustes & { page?: string; registrado?: string }>;
}

export default async function AjustesPage({ searchParams }: AjustesPageProps) {
  return (
    <div className="page list-view">
      <AjustesListado
        params={await searchParams}
        basePath="/stock/ajustes"
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: "Ajustes" }]}
      />
    </div>
  );
}
