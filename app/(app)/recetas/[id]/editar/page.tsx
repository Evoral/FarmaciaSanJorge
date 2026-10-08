/** `/recetas/[id]/editar` (FASE 6 point 6.3): solo mientras PENDIENTE_PREPARACION y sin ficha con preparación (validado también en el servidor por editarReceta). */
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { listUnidadesParaReceta } from "@/modules/recetas/application/list-unidades-para-receta";
import { esEstadoEditable } from "@/modules/recetas/domain/receta";
import { RecetaForm } from "@/modules/recetas/ui/receta-form";
import { inicialDesdeReceta } from "@/modules/recetas/ui/receta-form-inicial";
import { PageHeader } from "@/shared/ui/page-header";

interface EditarRecetaPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditarRecetaPage({ params }: EditarRecetaPageProps) {
  const session = await requireSession();
  if (!can(session, "recetas.editar")) redirect("/recetas");

  const { id } = await params;
  const receta = await getReceta(id);
  if (!receta) notFound();

  // A preparación INICIADA (a reserva de stock) blocks editing too; the command re-checks it under lock.
  if (!esEstadoEditable(receta.estado) || receta.itemsConPreparacionIniciada.length > 0) {
    redirect(`/recetas/${id}`);
  }

  const unidades = await listUnidadesParaReceta();

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "Inicio", href: "/" },
          { label: "Recetas", href: "/recetas" },
          { label: `Nº ${receta.numeroInterno}`, href: `/recetas/${id}` },
          { label: "Editar" },
        ]}
        title={
          <>
            Editar receta Nº <span className="font-mono">{receta.numeroInterno}</span>
          </>
        }
        description="Se puede corregir mientras está pendiente de preparación. Al guardar, las fichas técnicas se recalculan."
      />
      <RecetaForm mode="editar" unidades={unidades} disabled={false} recetaId={receta.id} inicial={inicialDesdeReceta(receta)} />
    </div>
  );
}
