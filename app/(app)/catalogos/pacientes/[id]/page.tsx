/** `/catalogos/pacientes/[id]` (M06, FASE 4 point 4.5): edit + baja/reactivar. HEALTH-ADJACENT DATA (DP-24) -- `[id]` in the path is an opaque UUID, not a patient-identifying value. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getPaciente } from "@/modules/pacientes/application/get-paciente";
import { PacienteForm } from "@/modules/pacientes/ui/paciente-form";
import { MotivoForm } from "@/modules/pacientes/ui/motivo-form";
import { darDeBajaPacienteAction, reactivarPacienteAction } from "@/modules/pacientes/ui/actions";

interface PacienteDetallePageProps {
  params: Promise<{ id: string }>;
}

function fechaNacimientoISODate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export default async function PacienteDetallePage({ params }: PacienteDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const paciente = await getPaciente(id);
  if (!paciente) notFound();

  const puedeGestionar = can(session, "pacientes.gestionar");

  return (
    <div>
      <div className="mb-2">
        <Link href="/catalogos/pacientes" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <h1 className="mb-1 text-xl font-semibold">
        {paciente.apellido}, {paciente.nombre}
      </h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">{paciente.fechaBaja ? "Dado de baja" : "Vigente"}</p>

      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-lg font-medium">Datos</h2>
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
            }}
            disabled={!puedeGestionar}
          />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">Estado</h2>
          {paciente.fechaBaja ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Motivo de baja: {paciente.motivoBaja ?? "—"}</p>
              {puedeGestionar ? <MotivoForm action={reactivarPacienteAction} id={paciente.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
            </div>
          ) : puedeGestionar ? (
            <MotivoForm
              action={darDeBajaPacienteAction}
              id={paciente.id}
              label="Dar de baja"
              pendingLabel="Dando de baja…"
              helpText="Este paciente deja de ofrecerse para nuevas recetas, pero sigue resolviendo en históricos."
              submitClassName="rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:text-red-400"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
