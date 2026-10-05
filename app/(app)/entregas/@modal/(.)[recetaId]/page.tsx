/**
 * `/entregas/[recetaId]` opened from the `/entregas` list (soft navigation): the entrega actions as a pop-up over the
 * list, closed with `router.back()`. Deliberately minimal -- receta Nº, estado, paciente and the one action the estado
 * allows. A direct load of the same URL renders ../../[recetaId]/page.tsx instead.
 */
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { getEntregaEstado } from "@/modules/entregas/application/get-entrega-estado";
import { EntregaAcciones } from "@/modules/entregas/ui/entrega-acciones";
import { RouteDialog } from "@/shared/ui/route-dialog";
import { StatusBadge } from "@/shared/ui/status-badge";

interface EntregaModalPageProps {
  params: Promise<{ recetaId: string }>;
}

export default async function EntregaModalPage({ params }: EntregaModalPageProps) {
  const session = await requireSession();
  const { recetaId } = await params;

  const receta = await getReceta(recetaId);
  if (!receta) notFound();

  const entregaEstado = await getEntregaEstado({ recetaId });

  return (
    <RouteDialog
      title={
        <span className="flex flex-wrap items-center gap-2">
          Receta Nº <span className="font-mono">{receta.numeroInterno}</span>
          <StatusBadge estado={receta.estado} />
        </span>
      }
      subtitle={`${receta.pacienteNombre} ${receta.pacienteApellido}`}
    >
      <EntregaAcciones
        recetaId={receta.id}
        estado={receta.estado}
        itemsExcluidos={entregaEstado.itemsExcluidos}
        puedeRegistrar={can(session, "entregas.registrar")}
        puedeConfirmarFirma={can(session, "entregas.firma.confirmar")}
      />
    </RouteDialog>
  );
}
