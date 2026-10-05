"use server";

/** Read-only suggestions for the `/proveedores` search: a thin wrapper over `listProveedores` (same `proveedores.gestionar` permiso, same razón social/CUIT search). */
import { listProveedores } from "@/modules/proveedores/application/list-proveedores";
import { formatCuit } from "@/modules/proveedores/domain/proveedor";
import type { SugerenciaNavegable } from "@/shared/ui/buscador-navegable";

export async function buscarProveedoresCatalogoAction(busqueda: string): Promise<SugerenciaNavegable[]> {
  const search = String(busqueda ?? "").trim().slice(0, 100);
  const result = await listProveedores({ search: search || undefined, page: 1, pageSize: 10 });
  return result.items.map((proveedor) => ({
    id: proveedor.id,
    label: `${proveedor.razonSocial}${proveedor.fechaBaja ? " (baja)" : ""}`,
    description: formatCuit(proveedor.cuit),
  }));
}
