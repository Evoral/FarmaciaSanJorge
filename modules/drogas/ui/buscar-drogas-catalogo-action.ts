"use server";

/** Read-only suggestions for the `/catalogos/drogas` search: a thin wrapper over `listDrogas` (same `drogas.editar` permiso, same search: name or vigente synonym, accent-insensitive). */
import { listDrogas } from "@/modules/drogas/application/list-drogas";
import type { SugerenciaNavegable } from "@/shared/ui/buscador-navegable";

export async function buscarDrogasCatalogoAction(busqueda: string): Promise<SugerenciaNavegable[]> {
  const search = String(busqueda ?? "").trim().slice(0, 100);
  const result = await listDrogas({ search: search || undefined, page: 1, pageSize: 10 });
  return result.items.map((droga) => ({
    id: droga.id,
    label: droga.fechaBaja ? `${droga.nombre} (baja)` : droga.nombre,
    description: droga.unidadBaseSimbolo,
    sinonimo: droga.sinonimoCoincidente,
  }));
}
