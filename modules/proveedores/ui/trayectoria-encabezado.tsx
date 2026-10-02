/**
 * Header of `/proveedores/[id]/trayectoria`: razón social, CUIT (formatted) and
 * estado (vigente / dado de baja + motivo). Server component. Rendered only for
 * sessions that passed `proveedores.gestionar`.
 */
import { StatusBadge } from "@/shared/ui/status-badge";
import { formatCuit } from "../domain/proveedor";
import type { ProveedorTrayectoria } from "../domain/trayectoria";

export function TrayectoriaEncabezado({ proveedor }: { proveedor: ProveedorTrayectoria }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold">{proveedor.razonSocial}</h1>
      <dl className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-1.5">
          <dt className="text-zinc-500">CUIT</dt>
          <dd>{formatCuit(proveedor.cuit)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-zinc-500">Estado</dt>
          <dd>
            <StatusBadge estado={proveedor.fechaBaja ? "BAJA" : "VIGENTE"} />
          </dd>
        </div>
        {proveedor.fechaBaja ? (
          <div className="flex items-center gap-1.5">
            <dt className="text-zinc-500">Motivo de baja</dt>
            <dd>{proveedor.motivoBaja ?? "—"}</dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}
