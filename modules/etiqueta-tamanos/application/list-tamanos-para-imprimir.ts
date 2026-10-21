/**
 * `listTamanosParaImprimir`: the ACTIVE sizes offered in the "Seleccionar
 * tamaño" dialog when printing an etiqueta, in the admin list's order (by name),
 * keeping only the ones that fit the sheet at least once (docs/specs/hoja-etiquetas.md
 * R5: a size that does not fit, e.g. wider than 200 mm under the seeded A4 / 5 mm,
 * is not offered). Gated on `etiquetas.imprimir` (FAR/DT), NOT on `config.ver`:
 * whoever prints is not an administrator, and must see the sizes the
 * administrator configured.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { entraEnHoja } from "../domain/etiqueta-hoja";
import { getEtiquetaHoja } from "../infrastructure/etiqueta-hoja-repository";
import { listEtiquetaTamanosActivos } from "../infrastructure/etiqueta-tamano-repository";
import type { EtiquetaTamano } from "../domain/etiqueta-tamano";

export const listTamanosParaImprimirQuery = defineQuery({
  name: "etiquetaTamanos.paraImprimir",
  permiso: "etiquetas.imprimir",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<EtiquetaTamano[]> => {
    const hoja = await getEtiquetaHoja(tx, session.tenantId);
    const activos = await listEtiquetaTamanosActivos(tx, session.tenantId);
    return activos.filter((tamano) => entraEnHoja(hoja, tamano));
  },
});

export async function listTamanosParaImprimir(): Promise<EtiquetaTamano[]> {
  return listTamanosParaImprimirQuery.execute({});
}
