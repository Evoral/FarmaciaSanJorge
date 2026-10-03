"use server";

/** Read-only droga suggestions for the `/libro/contralor` autocomplete: a thin wrapper over `listDrogasContralor` (libro.ver). */
import { listDrogasContralor, type DrogaContralorOpcion } from "@/modules/libro/application/list-drogas-contralor";

export async function buscarDrogasContralorAction(busqueda: string): Promise<DrogaContralorOpcion[]> {
  return listDrogasContralor({ search: String(busqueda ?? "").slice(0, 100) });
}
