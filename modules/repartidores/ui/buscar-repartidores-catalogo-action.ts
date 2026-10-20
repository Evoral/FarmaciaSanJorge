"use server";

/** Read-only suggestions for the `/catalogos/repartidores` search: a thin wrapper over `listRepartidores` (same `repartidores.gestionar` permiso, same nombre / apellido / teléfono search). */
import { listRepartidores } from "@/modules/repartidores/application/list-repartidores";
import type { SugerenciaNavegable } from "@/shared/ui/buscador-navegable";

export async function buscarRepartidoresCatalogoAction(busqueda: string): Promise<SugerenciaNavegable[]> {
  const search = String(busqueda ?? "").trim().slice(0, 100);
  const result = await listRepartidores({ search: search || undefined, page: 1, pageSize: 10 });
  return result.items.map((repartidor) => ({
    id: repartidor.id,
    label: `${repartidor.apellido}, ${repartidor.nombre}${repartidor.activo ? "" : " (inactivo)"}`,
    description: repartidor.telefono,
  }));
}
