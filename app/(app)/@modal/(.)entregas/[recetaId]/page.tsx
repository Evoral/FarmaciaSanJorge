/**
 * `/entregas/[recetaId]` opened by a soft navigation from any section: the entrega actions as a pop-up over the current
 * page, closed with `router.back()`. Deliberately minimal -- receta Nº, estado, paciente and the one action the estado
 * allows. A direct load of the same URL renders ../../../entregas/[recetaId]/page.tsx instead.
 *
 * The slot lives in the `(app)` layout and intercepts the static `entregas` segment: intercepting the dynamic segment
 * from `entregas/@modal/(.)[recetaId]` failed in Next.js 16 ("Invalid interception route: /entregas/(.)(.)…") and
 * fell back to the full page. Outside `entregas/layout.tsx`, so this page checks `entregas.registrar` itself.
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
  if (!can(session, "entregas.registrar")) notFound();
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
        pagada={entregaEstado.pagada}
        itemsExcluidos={entregaEstado.itemsExcluidos}
        domicilioPaciente={entregaEstado.domicilioPaciente}
        repartidor={entregaEstado.repartidor}
        hayRepartidoresActivos={entregaEstado.hayRepartidoresActivos}
        puedeGestionarRepartidores={can(session, "repartidores.gestionar")}
        puedeRegistrar={can(session, "entregas.registrar")}
        puedeConfirmarFirma={can(session, "entregas.registrar")}
        retiroVencido={entregaEstado.retiroVencido}
      />
    </RouteDialog>
  );
}
