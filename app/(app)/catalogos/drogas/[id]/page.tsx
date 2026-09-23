/** `/catalogos/drogas/[id]` (M06, FASE 4 point 4.2): edit + baja/reactivar. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getDroga } from "@/modules/drogas/application/get-droga";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { DrogaForm } from "@/modules/drogas/ui/droga-form";
import { MotivoForm } from "@/modules/drogas/ui/motivo-form";
import { darDeBajaDrogaAction, reactivarDrogaAction } from "@/modules/drogas/ui/actions";

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
    <div>
      <div className="mb-2">
        <Link href="/catalogos/drogas" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <h1 className="mb-1 text-xl font-semibold">{droga.nombre}</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">{droga.fechaBaja ? "Dada de baja" : "Vigente"}</p>

      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-lg font-medium">Datos</h2>
          <DrogaForm mode="editar" unidades={unidades} droga={droga} disabled={!puedeEditar} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">Estado</h2>
          {droga.fechaBaja ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Motivo de baja: {droga.motivoBaja ?? "—"}</p>
              {puedeReactivar ? <MotivoForm action={reactivarDrogaAction} id={droga.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
            </div>
          ) : puedeBaja ? (
            <MotivoForm
              action={darDeBajaDrogaAction}
              id={droga.id}
              label="Dar de baja"
              pendingLabel="Dando de baja…"
              helpText="Esta droga deja de ofrecerse para nuevas recetas, pero sigue resolviendo en históricos."
              submitClassName="rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:text-red-400"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
