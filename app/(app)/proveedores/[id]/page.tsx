/**
 * `/proveedores/[id]` (M06, FASE 4 point 4.3): edit + baja/reactivar. Layout: the data form in the main column; the
 * estado and its baja/reactivar action in the aside (same shape as /catalogos/medicos/[id]). The Datos/Trayectoria
 * tabs sit under the header (`ProveedorTabs`).
 */
import { notFound } from "next/navigation";
import { uuid } from "@/shared/validation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getProveedor } from "@/modules/proveedores/application/get-proveedor";
import { formatCuit } from "@/modules/proveedores/domain/proveedor";
import { ProveedorForm } from "@/modules/proveedores/ui/proveedor-form";
import { MotivoForm } from "@/shared/ui/motivo-form";
import { darDeBajaProveedorAction, reactivarProveedorAction } from "@/modules/proveedores/ui/actions";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import { ProveedorTabs } from "../proveedor-tabs";

interface ProveedorDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function ProveedorDetallePage({ params }: ProveedorDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;
  // The layout already 404s a malformed id; the page guards on its own too (same as pacientes/[id]/page.tsx).
  if (!uuid.safeParse(id).success) notFound();

  const proveedor = await getProveedor(id);
  if (!proveedor) notFound();

  const puedeGestionar = can(session, "proveedores.gestionar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Proveedores", href: "/proveedores" }, { label: proveedor.razonSocial }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {proveedor.razonSocial}
            <ToneBadge tone={proveedor.fechaBaja ? "neutral" : "success"}>{proveedor.fechaBaja ? "Dado de baja" : "Vigente"}</ToneBadge>
          </span>
        }
        description={
          <>
            CUIT <span className="font-mono text-zinc-900">{formatCuit(proveedor.cuit)}</span>
          </>
        }
      />

      <ProveedorTabs id={proveedor.id} />

      <div className="split-layout">
        <section aria-labelledby="datos-heading" className="panel min-w-0">
          <div className="panel-header">
            <h2 id="datos-heading">Datos</h2>
          </div>
          <div className="panel-body">
            <ProveedorForm mode="editar" proveedor={proveedor} disabled={!puedeGestionar} />
          </div>
        </section>

        <aside className="split-aside" aria-label="Estado del proveedor">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              {proveedor.fechaBaja ? (
                <>
                  <dl className="summary-dl">
                    <dt>Estado</dt>
                    <dd>Dado de baja</dd>
                    <dt>Motivo</dt>
                    <dd data-empty={!proveedor.motivoBaja || undefined} title={proveedor.motivoBaja ?? undefined}>
                      {proveedor.motivoBaja ?? "Sin motivo"}
                    </dd>
                  </dl>
                  {puedeGestionar ? <MotivoForm action={reactivarProveedorAction} id={proveedor.id} label="Reactivar" pendingLabel="Reactivando…" /> : null}
                </>
              ) : (
                <>
                  <p className="text-[0.8125rem] text-zinc-600">Vigente: se ofrece en partidas nuevas.</p>
                  {puedeGestionar ? (
                    <MotivoForm
                      action={darDeBajaProveedorAction}
                      id={proveedor.id}
                      label="Dar de baja"
                      pendingLabel="Dando de baja…"
                      helpText="Este proveedor deja de ofrecerse para nuevas partidas, pero sigue resolviendo en históricos."
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
