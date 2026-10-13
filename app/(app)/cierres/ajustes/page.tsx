/**
 * `/cierres/ajustes` -- "Gestión DT › Ajustes de stock": the same
 * list as `/stock/ajustes` (`modules/stock/ui/ajustes-listado.tsx`), with
 * the section's tab nav. "Registrar ajuste" opens the shared creation flow,
 * which returns to `/stock/ajustes`. Guard: `./layout.tsx` (`stock.ver`).
 */
import { requireSession } from "@/shared/auth/session";
import type { ParamsAjustes } from "@/modules/stock/domain/ajustes-listado";
import { AjustesListado } from "@/modules/stock/ui/ajustes-listado";
import { SectionTabs } from "../../section-tabs";
import { gestionDtSections } from "../../nav-sections";

interface AjustesDtPageProps {
  searchParams: Promise<ParamsAjustes & { page?: string; registrado?: string }>;
}

export default async function AjustesDtPage({ searchParams }: AjustesDtPageProps) {
  const session = await requireSession();
  return (
    <div className="page list-view">
      <AjustesListado
        params={await searchParams}
        basePath="/cierres/ajustes"
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Gestión DT" }, { label: "Ajustes de stock" }]}
        title="Ajustes de stock"
        tabs={<SectionTabs ariaLabel="Secciones de gestión DT" links={gestionDtSections(session)} />}
      />
    </div>
  );
}
