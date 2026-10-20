/** `/catalogos/repartidores/[id]`: edit + activar/desactivar. The data form in the main column; the estado and its action in the aside. */
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getRepartidor } from "@/modules/repartidores/application/get-repartidor";
import { RepartidorForm } from "@/modules/repartidores/ui/repartidor-form";
import { RepartidorEstadoAcciones } from "@/modules/repartidores/ui/estado-acciones";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

interface RepartidorDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function RepartidorDetallePage({ params }: RepartidorDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const repartidor = await getRepartidor(id);
  if (!repartidor) notFound();

  const puedeGestionar = can(session, "repartidores.gestionar");
  const nombre = `${repartidor.apellido}, ${repartidor.nombre}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Catálogos" }, { label: "Repartidores", href: "/catalogos/repartidores" }, { label: nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {nombre}
            <ToneBadge tone={repartidor.activo ? "success" : "neutral"}>{repartidor.activo ? "Activo" : "Inactivo"}</ToneBadge>
          </span>
        }
        description={
          <>
            Teléfono <span className="font-mono text-zinc-900">{repartidor.telefono}</span>
          </>
        }
      />

      <div className="split-layout">
        <section aria-labelledby="datos-heading" className="panel min-w-0">
          <div className="panel-header">
            <h2 id="datos-heading">Datos</h2>
          </div>
          <div className="panel-body">
            <RepartidorForm mode="editar" repartidor={{ id: repartidor.id, nombre: repartidor.nombre, apellido: repartidor.apellido, telefono: repartidor.telefono }} disabled={!puedeGestionar} />
          </div>
        </section>

        <aside className="split-aside" aria-label="Estado del repartidor">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              {repartidor.activo ? (
                <p className="text-[0.8125rem] text-zinc-600">Activo: se ofrece al registrar envíos nuevos.</p>
              ) : (
                <p className="text-[0.8125rem] text-zinc-600">Inactivo: no se ofrece para envíos nuevos, pero conserva los que ya tiene y se puede exportar su hoja de envíos.</p>
              )}
              {puedeGestionar ? <RepartidorEstadoAcciones id={repartidor.id} activo={repartidor.activo} /> : null}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
