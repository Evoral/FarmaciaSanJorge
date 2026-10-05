/**
 * `/pacientes/[id]` (M06, FASE 4 point 4.5): edit + baja/reactivar. HEALTH-ADJACENT DATA (DP-24) -- `[id]` in the path
 * is an opaque UUID, not a patient-identifying value. Layout: the data form in the main column; the estado and its
 * baja/reactivar action in the aside (same shape as /catalogos/medicos/[id]).
 */
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getPaciente } from "@/modules/pacientes/application/get-paciente";
import { PacienteForm } from "@/modules/pacientes/ui/paciente-form";
import { uuid } from "@/shared/validation";
import { MotivoForm } from "@/shared/ui/motivo-form";
import { darDeBajaPacienteAction, reactivarPacienteAction } from "@/modules/pacientes/ui/actions";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import { PacienteTabs } from "../pacientes-tabs";

interface PacienteDetallePageProps {
  params: Promise<{ id: string }>;
}

function fechaNacimientoISODate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export default async function PacienteDetallePage({ params }: PacienteDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const paciente = await getPaciente(id);
  if (!paciente) notFound();

  const puedeGestionar = can(session, "pacientes.gestionar");
  const nombre = `${paciente.apellido}, ${paciente.nombre}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Pacientes", href: "/pacientes" }, { label: nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {nombre}
            <ToneBadge tone={paciente.fechaBaja ? "neutral" : "success"}>{paciente.fechaBaja ? "Dado de baja" : "Vigente"}</ToneBadge>
          </span>
        }
        description={
          paciente.dni || paciente.nroCredencial ? (
            <span className="meta-line">
              {paciente.dni ? (
                <span>
                  DNI <span className="font-mono text-zinc-900">{paciente.dni}</span>
                </span>
              ) : null}
              {paciente.nroCredencial ? (
                <span>
                  Credencial <span className="font-mono text-zinc-900">{paciente.nroCredencial}</span>
                </span>
              ) : null}
            </span>
          ) : undefined
        }
      />

      <PacienteTabs id={paciente.id} />

      <div className="split-layout">
        <section aria-labelledby="datos-heading" className="panel min-w-0">
          <div className="panel-header">
            <h2 id="datos-heading">Datos</h2>
          </div>
          <div className="panel-body">
            <PacienteForm
              mode="editar"
              paciente={{
                id: paciente.id,
                nombre: paciente.nombre,
                apellido: paciente.apellido,
                cuil: paciente.cuil,
                dni: paciente.dni,
                telefono: paciente.telefono,
                email: paciente.email,
                fechaNacimiento: fechaNacimientoISODate(paciente.fechaNacimiento),
                nroCredencial: paciente.nroCredencial,
                sexo: paciente.sexo,
                aceptaRecordatoriosWhatsapp: paciente.aceptaRecordatoriosWhatsapp,
              }}
              disabled={!puedeGestionar}
            />
          </div>
        </section>

        <aside className="split-aside" aria-label="Estado del paciente">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              {paciente.fechaBaja ? (
                <>
                  <dl className="summary-dl">
                    <dt>Estado</dt>
                    <dd>Dado de baja</dd>
                    <dt>Motivo</dt>
                    <dd data-empty={!paciente.motivoBaja || undefined} title={paciente.motivoBaja ?? undefined}>
                      {paciente.motivoBaja ?? "Sin motivo"}
                    </dd>
                  </dl>
                  {puedeGestionar ? <MotivoForm action={reactivarPacienteAction} id={paciente.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
                </>
              ) : (
                <>
                  <p className="text-[0.8125rem] text-zinc-600">Vigente: se ofrece en recetas nuevas.</p>
                  {puedeGestionar ? (
                    <MotivoForm
                      action={darDeBajaPacienteAction}
                      id={paciente.id}
                      label="Dar de baja"
                      pendingLabel="Dando de baja…"
                      helpText="Este paciente deja de ofrecerse para nuevas recetas, pero sigue resolviendo en históricos."
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
