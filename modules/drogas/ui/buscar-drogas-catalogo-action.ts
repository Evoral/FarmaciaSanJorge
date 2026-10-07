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

/** A droga that already answers to a name being typed in the alta form (by its name or a vigente synonym). */
export interface DrogaExistente {
  id: string;
  nombre: string;
  sinonimos: string[];
  /** The synonym that matched, when the name itself did not. */
  sinonimoCoincidente: string | null;
  baja: boolean;
}

/**
 * Live duplicate check while creating a droga (docs/specs/sinonimos-droga.md): drogas, vigente or not, whose name or
 * vigente synonym contains the typed text (accent- and case-insensitive). The command re-checks on submit.
 */
export async function buscarDrogasExistentesAction(texto: string): Promise<DrogaExistente[]> {
  const search = String(texto ?? "").trim().slice(0, 100);
  if (search.length === 0) return [];
  const result = await listDrogas({ search, page: 1, pageSize: 6 });
  return result.items.map((droga) => ({
    id: droga.id,
    nombre: droga.nombre,
    sinonimos: droga.sinonimos,
    sinonimoCoincidente: droga.sinonimoCoincidente,
    baja: droga.fechaBaja !== null,
  }));
}
