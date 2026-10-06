/**
 * Header of `/proveedores/[id]/historial`: breadcrumbs back to the list, razón social, estado (vigente / dado de baja
 * + motivo) and CUIT (formatted). Server component. Rendered only for sessions that passed `proveedores.gestionar`.
 */
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import { formatCuit } from "../domain/proveedor";
import type { ProveedorTrayectoria } from "../domain/trayectoria";

export function TrayectoriaEncabezado({ proveedor }: { proveedor: ProveedorTrayectoria }) {
  return (
    <PageHeader
      breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Proveedores", href: "/proveedores" }, { label: proveedor.razonSocial }]}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {proveedor.razonSocial}
          <ToneBadge tone={proveedor.fechaBaja ? "neutral" : "success"}>{proveedor.fechaBaja ? "Dado de baja" : "Vigente"}</ToneBadge>
        </span>
      }
      description={
        <span className="meta-line">
          <span>
            CUIT <span className="font-mono text-zinc-900">{formatCuit(proveedor.cuit)}</span>
          </span>
          {proveedor.fechaBaja ? <span>Motivo de baja: {proveedor.motivoBaja ?? "sin motivo"}</span> : null}
        </span>
      }
    />
  );
}
