/** `/admin/unidades/[id]` (M05, FASE 4 point 4.1): edit + baja/reactivar. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getUnidad } from "@/modules/unidades/application/get-unidad";
import { UnidadForm } from "@/modules/unidades/ui/unidad-form";
import { MotivoForm } from "@/modules/unidades/ui/motivo-form";
import { darDeBajaUnidadAction, reactivarUnidadAction } from "@/modules/unidades/ui/actions";

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
    <div>
      <div className="mb-2">
        <Link href="/admin/unidades" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <h1 className="mb-1 text-2xl font-semibold">
        {unidad.nombre} ({unidad.simbolo})
      </h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {unidad.codigo} · {unidad.fechaBaja ? "Dada de baja" : "Vigente"}
      </p>

      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-lg font-medium">Datos</h2>
          <UnidadForm mode="editar" unidad={unidad} disabled={!puedeEditar} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">Estado</h2>
          {unidad.fechaBaja ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Motivo de baja: {unidad.motivoBaja ?? "—"}</p>
              {puedeBaja ? <MotivoForm action={reactivarUnidadAction} id={unidad.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
            </div>
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
              submitClassName="btn btn-danger"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
