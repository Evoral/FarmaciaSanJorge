/** `/catalogos/medicos/[id]` (M06, FASE 4 point 4.4): edit + baja/reactivar. Layout: the data form in the main column; the estado and its baja/reactivar action in the aside. */
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getMedico } from "@/modules/medicos/application/get-medico";
import { MedicoForm } from "@/modules/medicos/ui/medico-form";
import { formatMatricula } from "@/modules/medicos/domain/medico";
import { MotivoForm } from "@/shared/ui/motivo-form";
import { darDeBajaMedicoAction, reactivarMedicoAction } from "@/modules/medicos/ui/actions";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

interface MedicoDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function MedicoDetallePage({ params }: MedicoDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const medico = await getMedico(id);
  if (!medico) notFound();

  const puedeGestionar = can(session, "medicos.gestionar");
  const nombre = `${medico.apellido}, ${medico.nombre}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Catálogos" }, { label: "Médicos", href: "/catalogos/medicos" }, { label: nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {nombre}
            <ToneBadge tone={medico.fechaBaja ? "neutral" : "success"}>{medico.fechaBaja ? "Dado de baja" : "Vigente"}</ToneBadge>
          </span>
        }
        description={
          <>
            Matrícula <span className="font-mono text-zinc-900">{formatMatricula(medico.matriculaJurisdiccion, medico.matricula)}</span>
          </>
        }
      />

      <div className="split-layout">
        <section aria-labelledby="datos-heading" className="panel min-w-0">
          <div className="panel-header">
            <h2 id="datos-heading">Datos</h2>
          </div>
          <div className="panel-body">
            <MedicoForm mode="editar" medico={medico} disabled={!puedeGestionar} />
          </div>
        </section>

        <aside className="split-aside" aria-label="Estado del médico">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              {medico.fechaBaja ? (
                <>
                  <dl className="summary-dl">
                    <dt>Estado</dt>
                    <dd>Dado de baja</dd>
                    <dt>Motivo</dt>
                    <dd data-empty={!medico.motivoBaja || undefined} title={medico.motivoBaja ?? undefined}>
                      {medico.motivoBaja ?? "Sin motivo"}
                    </dd>
                  </dl>
                  {puedeGestionar ? <MotivoForm action={reactivarMedicoAction} id={medico.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
                </>
              ) : (
                <>
                  <p className="text-[0.8125rem] text-zinc-600">Vigente: se ofrece en recetas nuevas.</p>
                  {puedeGestionar ? (
                    <MotivoForm
                      action={darDeBajaMedicoAction}
                      id={medico.id}
                      label="Dar de baja"
                      pendingLabel="Dando de baja…"
                      helpText="Este médico deja de ofrecerse para nuevas recetas, pero sigue resolviendo en históricos."
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
