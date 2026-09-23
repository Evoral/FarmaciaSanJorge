/** `/recetas/nuevo` (FASE 6 point 6.1). */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listUnidadesParaReceta } from "@/modules/recetas/application/list-unidades-para-receta";
import { RecetaForm } from "@/modules/recetas/ui/receta-form";

export default async function NuevaRecetaPage() {
  const session = await requireSession();
  if (!can(session, "recetas.crear")) redirect("/recetas");

  const unidades = await listUnidadesParaReceta();

  return (
    <div className="p-6">
      <div className="mb-2">
        <Link href="/recetas" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>
      <h1 className="mb-6 text-xl font-semibold">Nueva receta</h1>
      <RecetaForm mode="crear" unidades={unidades} disabled={false} />
    </div>
  );
}
