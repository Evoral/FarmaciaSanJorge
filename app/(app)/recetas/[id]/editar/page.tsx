/** `/recetas/[id]/editar` (FASE 6 point 6.3): solo mientras PENDIENTE_PREPARACION y sin ficha con preparación (validado también en el servidor por editarReceta). */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { listUnidadesParaReceta } from "@/modules/recetas/application/list-unidades-para-receta";
import { esEstadoEditable } from "@/modules/recetas/domain/receta";
import { RecetaForm } from "@/modules/recetas/ui/receta-form";

interface EditarRecetaPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditarRecetaPage({ params }: EditarRecetaPageProps) {
  const session = await requireSession();
  if (!can(session, "recetas.editar")) redirect("/recetas");

  const { id } = await params;
  const receta = await getReceta(id);
  if (!receta) notFound();

  if (!esEstadoEditable(receta.estado)) {
    redirect(`/recetas/${id}`);
  }

  const unidades = await listUnidadesParaReceta();

  return (
    <div className="page">
      <div className="mb-2">
        <Link href={`/recetas/${id}`} className="text-sm underline">
          ← Volver al detalle
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">Editar receta Nº {receta.numeroInterno}</h1>
      <RecetaForm
        mode="editar"
        unidades={unidades}
        disabled={false}
        recetaId={receta.id}
        inicial={{
          pacienteId: receta.pacienteId,
          pacienteLabel: `${receta.pacienteApellido}, ${receta.pacienteNombre}`,
          medicoId: receta.medicoId,
          medicoLabel: `${receta.medicoApellido}, ${receta.medicoNombre}`,
          fechaPrescripcion: receta.fechaPrescripcion.toISOString().slice(0, 10),
          origen: receta.origen,
          items: receta.items.map((item) => ({
            id: item.id,
            descripcion: item.descripcion ?? "",
            formaFarmaceutica: item.formaFarmaceutica,
            cantidadUnidades: String(item.cantidadUnidades),
            fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
            cantidadTotal: item.cantidadTotal ?? "",
            unidadTotalId: item.unidadTotalId ?? "",
            observaciones: item.observaciones ?? "",
            componentes: item.componentes.map((c) => ({
              id: c.id,
              drogaId: c.drogaId,
              drogaNombre: c.drogaNombre,
              cantidad: c.cantidad ?? "",
              unidadMedidaId: c.unidadMedidaId,
              modoExpresion: c.modoExpresion,
              esPrincipioActivo: c.esPrincipioActivo,
            })),
          })),
        }}
      />
    </div>
  );
}
