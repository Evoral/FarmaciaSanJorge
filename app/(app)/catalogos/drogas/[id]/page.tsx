/** `/catalogos/drogas/[id]` (M06, FASE 4 point 4.2): edit + baja/reactivar. Layout: the data form in the main column; the estado and its baja/reactivar action in the aside. */
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getDroga } from "@/modules/drogas/application/get-droga";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { DrogaForm } from "@/modules/drogas/ui/droga-form";
import { MotivoForm } from "@/shared/ui/motivo-form";
import { darDeBajaDrogaAction, reactivarDrogaAction } from "@/modules/drogas/ui/actions";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import { puedeVerHistorialDroga } from "@/modules/drogas/application/get-historial-droga";
import { DrogaTabs } from "../droga-tabs";

interface DrogaDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function DrogaDetallePage({ params }: DrogaDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const droga = await getDroga(id);
  if (!droga) notFound();

  const unidades = await listUnidadesVigentesParaDroga();
  const puedeEditar = can(session, "drogas.editar");
  const puedeBaja = can(session, "drogas.baja");
  const puedeReactivar = can(session, "drogas.reactivar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Catálogos" }, { label: "Drogas", href: "/catalogos/drogas" }, { label: droga.nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {droga.nombre}
            <ToneBadge tone={droga.fechaBaja ? "neutral" : "success"}>{droga.fechaBaja ? "Dada de baja" : "Vigente"}</ToneBadge>
          </span>
        }
      />
      <DrogaTabs id={droga.id} conHistorial={puedeVerHistorialDroga(session)} />

      <div className="split-layout">
        <section aria-labelledby="datos-heading" className="panel min-w-0">
          <div className="panel-header">
            <h2 id="datos-heading">Datos</h2>
            {!puedeEditar ? <p>Solo lectura: no tenés permiso para editar drogas.</p> : null}
          </div>
          <div className="panel-body">
            <DrogaForm mode="editar" unidades={unidades} droga={droga} disabled={!puedeEditar} />
          </div>
        </section>

        <aside className="split-aside" aria-label="Estado de la droga">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              {droga.fechaBaja ? (
                <>
                  <dl className="summary-dl">
                    <dt>Estado</dt>
                    <dd>Dada de baja</dd>
                    <dt>Motivo</dt>
                    <dd data-empty={!droga.motivoBaja || undefined} title={droga.motivoBaja ?? undefined}>
                      {droga.motivoBaja ?? "Sin motivo"}
                    </dd>
                  </dl>
                  {puedeReactivar ? <MotivoForm action={reactivarDrogaAction} id={droga.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
                </>
              ) : (
                <>
                  <p className="text-[0.8125rem] text-zinc-600">Vigente: se ofrece en recetas nuevas.</p>
                  {puedeBaja ? (
                    <MotivoForm
                      action={darDeBajaDrogaAction}
                      id={droga.id}
                      label="Dar de baja"
                      pendingLabel="Dando de baja…"
                      helpText="Esta droga deja de ofrecerse para nuevas recetas, pero sigue resolviendo en históricos."
                      variant="danger"
                    />
                  ) : null}
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
