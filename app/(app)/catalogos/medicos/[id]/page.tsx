/** `/catalogos/medicos/[id]` (M06, FASE 4 point 4.4): edit + baja/reactivar. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getMedico } from "@/modules/medicos/application/get-medico";
import { MedicoForm } from "@/modules/medicos/ui/medico-form";
import { MotivoForm } from "@/modules/medicos/ui/motivo-form";
import { darDeBajaMedicoAction, reactivarMedicoAction } from "@/modules/medicos/ui/actions";

interface MedicoDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function MedicoDetallePage({ params }: MedicoDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const medico = await getMedico(id);
  if (!medico) notFound();

  const puedeGestionar = can(session, "medicos.gestionar");

  return (
    <div>
      <div className="mb-2">
        <Link href="/catalogos/medicos" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <h1 className="mb-1 text-2xl font-semibold">
        {medico.apellido}, {medico.nombre}
      </h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Matrícula {medico.matricula} · {medico.fechaBaja ? "Dado de baja" : "Vigente"}
      </p>

      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-lg font-medium">Datos</h2>
          <MedicoForm mode="editar" medico={medico} disabled={!puedeGestionar} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">Estado</h2>
          {medico.fechaBaja ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Motivo de baja: {medico.motivoBaja ?? "—"}</p>
              {puedeGestionar ? <MotivoForm action={reactivarMedicoAction} id={medico.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
            </div>
          ) : puedeGestionar ? (
            <MotivoForm
              action={darDeBajaMedicoAction}
              id={medico.id}
              label="Dar de baja"
              pendingLabel="Dando de baja…"
              helpText="Este médico deja de ofrecerse para nuevas recetas, pero sigue resolviendo en históricos."
              submitClassName="btn btn-danger"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
