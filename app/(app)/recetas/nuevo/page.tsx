/** `/recetas/nuevo` (FASE 6 point 6.1): carga manual o importación desde el PDF de una receta digital (docs/specs/importacion-receta-pdf.md). */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listUnidadesParaReceta } from "@/modules/recetas/application/list-unidades-para-receta";
import { NuevaReceta } from "@/modules/recetas/ui/nueva-receta";
import { PageHeader } from "@/shared/ui/page-header";

export default async function NuevaRecetaPage() {
  const session = await requireSession();
  if (!can(session, "recetas.crear")) redirect("/recetas");

  const unidades = await listUnidadesParaReceta();

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Recetas", href: "/recetas" }, { label: "Nueva receta" }]}
        title="Nueva receta"
        description="Cargá la receta a mano o importá el PDF de una receta digital."
      />
      <NuevaReceta unidades={unidades} puedePresupuestar={can(session, "cotizaciones.calcular")} />
    </div>
  );
}
