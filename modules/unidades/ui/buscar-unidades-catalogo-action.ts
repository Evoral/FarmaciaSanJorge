"use server";

/** Read-only suggestions for the `/catalogos/unidades` search: a thin wrapper over `listUnidades` (same `unidades.editar` permiso, same código/nombre/símbolo search). */
import { listUnidades } from "@/modules/unidades/application/list-unidades";
import type { SugerenciaNavegable } from "@/shared/ui/buscador-navegable";

export async function buscarUnidadesCatalogoAction(busqueda: string): Promise<SugerenciaNavegable[]> {
  const search = String(busqueda ?? "").trim().slice(0, 100);
  const result = await listUnidades({ search: search || undefined, page: 1, pageSize: 10 });
  return result.items.map((unidad) => ({
    id: unidad.id,
    label: `${unidad.nombre}${unidad.fechaBaja ? " (baja)" : ""}`,
    description: `${unidad.simbolo} · ${unidad.codigo}`,
  }));
}
