/** `/catalogos/unidades/[id]` (M05, FASE 4 point 4.1): edit + baja/reactivar. Layout: the data form in the main column; the estado, its usage and the baja/reactivar action in the aside. */
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getUnidad } from "@/modules/unidades/application/get-unidad";
import { UnidadForm } from "@/modules/unidades/ui/unidad-form";
import { MotivoForm } from "@/shared/ui/motivo-form";
import { darDeBajaUnidadAction, reactivarUnidadAction } from "@/modules/unidades/ui/actions";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

interface UnidadDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function UnidadDetallePage({ params }: UnidadDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const unidad = await getUnidad(id);
  if (!unidad) notFound();

  const puedeEditar = can(session, "unidades.editar");
  const puedeBaja = can(session, "unidades.baja");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Catálogos" }, { label: "Unidades de medida", href: "/catalogos/unidades" }, { label: unidad.nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {unidad.nombre} <span className="font-mono text-zinc-500">({unidad.simbolo})</span>
            <ToneBadge tone={unidad.fechaBaja ? "neutral" : "success"}>{unidad.fechaBaja ? "Dada de baja" : "Vigente"}</ToneBadge>
          </span>
        }
        description={
          <>
            Código <span className="font-mono text-zinc-900">{unidad.codigo}</span>
          </>
        }
      />

      <div className="split-layout">
        <section aria-labelledby="datos-heading" className="panel min-w-0">
          <div className="panel-header">
            <h2 id="datos-heading">Datos</h2>
          </div>
          <div className="panel-body">
            <UnidadForm mode="editar" unidad={unidad} disabled={!puedeEditar} />
          </div>
        </section>

        <aside className="split-aside" aria-label="Estado de la unidad">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              <dl className="summary-dl">
                <dt>Drogas que la usan</dt>
                <dd className="font-mono tabular-nums">{unidad.drogasQueLaUsan}</dd>
                {unidad.fechaBaja ? (
                  <>
                    <dt>Motivo de baja</dt>
                    <dd data-empty={!unidad.motivoBaja || undefined} title={unidad.motivoBaja ?? undefined}>
                      {unidad.motivoBaja ?? "Sin motivo"}
                    </dd>
                  </>
                ) : null}
              </dl>
              <p className="text-xs text-zinc-500">Contadas en todas las farmacias del sistema.</p>
              {unidad.fechaBaja ? (
                puedeBaja ? (
                  <MotivoForm action={reactivarUnidadAction} id={unidad.id} label="Reactivar" pendingLabel="Reactivando…" />
                ) : null
              ) : puedeBaja ? (
                <MotivoForm
                  action={darDeBajaUnidadAction}
                  id={unidad.id}
                  label="Dar de baja"
                  pendingLabel="Dando de baja…"
                  helpText={
                    unidad.drogasQueLaUsan > 0
                      ? `Esta unidad deja de ofrecerse para nuevas drogas, en cualquier farmacia, pero sigue resolviendo en históricos. Actualmente la usan ${unidad.drogasQueLaUsan} droga${unidad.drogasQueLaUsan === 1 ? "" : "s"} (en todas las farmacias del sistema).`
                      : "Esta unidad deja de ofrecerse para nuevas drogas, en cualquier farmacia, pero sigue resolviendo en históricos."
                  }
                  variant="danger"
                />
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
