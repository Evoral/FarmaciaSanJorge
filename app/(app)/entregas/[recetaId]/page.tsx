/**
 * `/entregas/[recetaId]` (FASE 11 points 11.1/11.2) on a direct load (link from another section, refresh). From the
 * `/entregas` list the same URL opens as a pop-up instead (`../@modal/(.)[recetaId]/page.tsx`); both render the same
 * minimal content: receta Nº, estado, paciente and the one action the estado allows (`EntregaAcciones`).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { getEntregaEstado } from "@/modules/entregas/application/get-entrega-estado";
import { EntregaAcciones } from "@/modules/entregas/ui/entrega-acciones";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusBadge } from "@/shared/ui/status-badge";

interface EntregaDetallePageProps {
  params: Promise<{ recetaId: string }>;
}

export default async function EntregaDetallePage({ params }: EntregaDetallePageProps) {
  const session = await requireSession();
  const { recetaId } = await params;

  const receta = await getReceta(recetaId);
  if (!receta) notFound();

  const entregaEstado = await getEntregaEstado({ recetaId });
  // The /recetas/** layout requires `recetas.crear`: only link there when it will open.
  const puedeVerReceta = can(session, "recetas.crear");

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Entregas", href: "/entregas" }, { label: `Receta Nº ${receta.numeroInterno}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Receta Nº <span className="font-mono">{receta.numeroInterno}</span>
            <StatusBadge estado={receta.estado} />
          </span>
        }
        description={`${receta.pacienteNombre} ${receta.pacienteApellido}`}
        actions={
          puedeVerReceta ? (
            <Link href={`/recetas/${receta.id}`} className="btn btn-secondary">
              <FileText className="size-4" aria-hidden />
              Ver receta
            </Link>
          ) : null
        }
      />

      <section className="panel max-w-md" aria-label="Entrega">
        <div className="panel-body">
          <EntregaAcciones
            recetaId={receta.id}
            estado={receta.estado}
            pagada={entregaEstado.pagada}
            itemsExcluidos={entregaEstado.itemsExcluidos}
            puedeRegistrar={can(session, "entregas.registrar")}
            puedeConfirmarFirma={can(session, "entregas.firma.confirmar")}
          />
        </div>
      </section>
    </div>
  );
}
