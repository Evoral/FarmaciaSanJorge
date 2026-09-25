/** `/catalogos/proveedores/[id]` (M06, FASE 4 point 4.3): edit + baja/reactivar. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getProveedor } from "@/modules/proveedores/application/get-proveedor";
import { formatCuit } from "@/modules/proveedores/domain/proveedor";
import { ProveedorForm } from "@/modules/proveedores/ui/proveedor-form";
import { MotivoForm } from "@/modules/proveedores/ui/motivo-form";
import { darDeBajaProveedorAction, reactivarProveedorAction } from "@/modules/proveedores/ui/actions";

interface ProveedorDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function ProveedorDetallePage({ params }: ProveedorDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const proveedor = await getProveedor(id);
  if (!proveedor) notFound();

  const puedeGestionar = can(session, "proveedores.gestionar");

  return (
    <div>
      <div className="mb-2">
        <Link href="/catalogos/proveedores" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <h1 className="mb-1 text-2xl font-semibold">{proveedor.razonSocial}</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {formatCuit(proveedor.cuit)} · {proveedor.fechaBaja ? "Dado de baja" : "Vigente"}
      </p>

      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-lg font-medium">Datos</h2>
          <ProveedorForm mode="editar" proveedor={proveedor} disabled={!puedeGestionar} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium">Estado</h2>
          {proveedor.fechaBaja ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Motivo de baja: {proveedor.motivoBaja ?? "—"}</p>
              {puedeGestionar ? <MotivoForm action={reactivarProveedorAction} id={proveedor.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
            </div>
          ) : puedeGestionar ? (
            <MotivoForm
              action={darDeBajaProveedorAction}
              id={proveedor.id}
              label="Dar de baja"
              pendingLabel="Dando de baja…"
              helpText="Este proveedor deja de ofrecerse para nuevas partidas, pero sigue resolviendo en históricos."
              submitClassName="btn btn-danger"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
