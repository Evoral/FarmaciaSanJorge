/** `/admin/configuracion/etiquetas/[id]`: edit a tamaño de etiqueta + baja/reactivar. The data form sits in the main column; the estado and its action in the aside. */
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getEtiquetaTamano } from "@/modules/etiqueta-tamanos/application/get-etiqueta-tamano";
import { formatearMedidas } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { EtiquetaTamanoForm } from "@/modules/etiqueta-tamanos/ui/etiqueta-tamano-form";
import { EtiquetaTamanoEstadoAcciones } from "@/modules/etiqueta-tamanos/ui/estado-acciones";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

interface EtiquetaTamanoDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function EtiquetaTamanoDetallePage({ params }: EtiquetaTamanoDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const tamano = await getEtiquetaTamano(id);
  if (!tamano) notFound();

  const puedeEditar = can(session, "config.editar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "Tamaños de etiqueta", href: "/admin/configuracion/etiquetas" }, { label: tamano.nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {tamano.nombre}
            <ToneBadge tone={tamano.activo ? "success" : "neutral"}>{tamano.activo ? "Activo" : "Dado de baja"}</ToneBadge>
          </span>
        }
        description={<span className="font-mono tabular-nums">{formatearMedidas(tamano)}</span>}
      />

      <div className="split-layout">
        <section aria-labelledby="datos-heading" className="panel min-w-0">
          <div className="panel-header">
            <h2 id="datos-heading">Datos</h2>
          </div>
          <div className="panel-body">
            <EtiquetaTamanoForm mode="editar" tamano={tamano} disabled={!puedeEditar} />
          </div>
        </section>

        <aside className="split-aside" aria-label="Estado del tamaño">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              <p className="text-sm text-zinc-600">{tamano.activo ? "Se ofrece al imprimir etiquetas." : "No se ofrece al imprimir etiquetas."}</p>
              {puedeEditar ? <EtiquetaTamanoEstadoAcciones id={tamano.id} activo={tamano.activo} /> : null}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
