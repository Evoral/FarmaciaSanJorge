/** `/recetas/nuevo` (FASE 6 point 6.1): carga manual o importación desde el PDF de una receta digital (docs/specs/importacion-receta-pdf.md). */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listUnidadesParaReceta } from "@/modules/recetas/application/list-unidades-para-receta";
import { NuevaReceta } from "@/modules/recetas/ui/nueva-receta";

export default async function NuevaRecetaPage() {
  const session = await requireSession();
  if (!can(session, "recetas.crear")) redirect("/recetas");

  const unidades = await listUnidadesParaReceta();

  return (
    <div className="page">
      <div className="mb-2">
        <Link href="/recetas" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">Nueva receta</h1>
      <NuevaReceta unidades={unidades} puedePresupuestar={can(session, "cotizaciones.calcular")} />
    </div>
  );
}
