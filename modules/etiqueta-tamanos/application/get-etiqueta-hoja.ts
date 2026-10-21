/** `getEtiquetaHoja`: the sheet for the admin screen (`/admin/configuracion/etiquetas`). `config.ver`. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getEtiquetaHoja as getEtiquetaHojaRepo } from "../infrastructure/etiqueta-hoja-repository";
import type { HojaEtiqueta } from "../domain/etiqueta-hoja";

export const getEtiquetaHojaQuery = defineQuery({
  name: "etiquetaHoja.ver",
  permiso: "config.ver",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<HojaEtiqueta> => getEtiquetaHojaRepo(tx, session.tenantId),
});

export async function getEtiquetaHoja(): Promise<HojaEtiqueta> {
  return getEtiquetaHojaQuery.execute({});
}
