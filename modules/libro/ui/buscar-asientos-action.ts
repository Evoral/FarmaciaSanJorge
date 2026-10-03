"use server";

/**
 * Read-only suggestions for the `/libro` paciente/médico autocomplete. A thin wrapper over the existing
 * `listAsientosRecetario` query: same `libro.ver` permiso (checked by the query), same `texto` match on the paciente and
 * médico snapshots, no writes. The term travels as a POST argument, never a URL (the list's own `texto` filter is
 * unchanged).
 */
import { listAsientosRecetario } from "@/modules/libro/application/list-asientos-recetario";

const MAX_RESULTADOS = 10;
const MAX_LARGO_BUSQUEDA = 100;

export interface AsientoSugerencia {
  id: string;
  numeroCorrelativo: string;
  fechaAsiento: string;
  pacienteTexto: string;
  medicoTexto: string;
}

export async function buscarAsientosRecetarioAction(busqueda: string): Promise<AsientoSugerencia[]> {
  const texto = String(busqueda ?? "").trim().slice(0, MAX_LARGO_BUSQUEDA);
  const result = await listAsientosRecetario({ texto: texto || undefined, page: 1, pageSize: MAX_RESULTADOS });
  return result.items.map((item) => ({
    id: item.id,
    numeroCorrelativo: item.numeroCorrelativo,
    fechaAsiento: item.fechaAsiento,
    pacienteTexto: item.pacienteTexto,
    medicoTexto: item.medicoTexto,
  }));
}
