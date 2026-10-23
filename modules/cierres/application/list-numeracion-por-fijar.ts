/**
 * `listNumeracionPorFijar` -- migration 0097 (INV-L26). The libros whose first number the cierre of `fecha` would
 * fix, with the number they start at: what the firma form asks the DT to confirm.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { fechaIso } from "../domain/filtros";
import { listLibrosPorFijarNumeracion, type LibroPorFijarNumeracion } from "../infrastructure/cierre-repository";

export type NumeracionPorFijarItem = LibroPorFijarNumeracion;

export const listNumeracionPorFijarQuery = defineQuery({
  name: "cierres.numeracion.por_fijar",
  permiso: "cierres.ver",
  input: z.object({ fecha: fechaIso }),
  handler: async ({ tx, session, input }): Promise<NumeracionPorFijarItem[]> => listLibrosPorFijarNumeracion(tx, session.tenantId, input.fecha, { bloquear: false }),
});

export async function listNumeracionPorFijar(fecha: string): Promise<NumeracionPorFijarItem[]> {
  return listNumeracionPorFijarQuery.execute({ fecha });
}
