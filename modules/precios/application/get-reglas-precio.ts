/**
 * `getReglasPrecio` (M08, FASE 4 point 4.6). Read of the tenant's current
 * margin + full version history, for `/admin/precios`. Same permiso as
 * editing (`precios.reglas.editar`) -- there is no dedicated
 * `precios.reglas.ver` in plan §7's matrix, so, same convention as
 * `unidades.editar` doubling as "may enter the section"
 * (modules/unidades/application/list-unidades.ts), this query is declared
 * with the module's own single permiso.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getReglaVigente, listHistorialReglas } from "../infrastructure/regla-precio-repository";

const getReglasPrecioInput = z.object({});

export interface ReglaPrecioVigenteOutput {
  id: string;
  margen: string;
  vigenteDesde: string;
  creadoPorNombre: string;
  creadoPorApellido: string;
}

export interface ReglaPrecioHistorialItemOutput {
  id: string;
  margen: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  creadoPorNombre: string;
  creadoPorApellido: string;
}

export interface GetReglasPrecioOutput {
  vigente: ReglaPrecioVigenteOutput | null;
  historial: ReglaPrecioHistorialItemOutput[];
}

export const getReglasPrecioQuery = defineQuery({
  name: "precios.reglas.consultar",
  permiso: "precios.reglas.editar",
  input: getReglasPrecioInput,
  handler: async ({ tx, session }) => {
    const [vigente, historial] = await Promise.all([getReglaVigente(tx, session.tenantId), listHistorialReglas(tx, session.tenantId)]);

    return {
      vigente: vigente
        ? {
            id: vigente.id,
            margen: vigente.margen,
            vigenteDesde: vigente.vigenteDesde.toISOString(),
            creadoPorNombre: vigente.creadoPorNombre,
            creadoPorApellido: vigente.creadoPorApellido,
          }
        : null,
      historial: historial.map((r) => ({
        id: r.id,
        margen: r.margen,
        vigenteDesde: r.vigenteDesde.toISOString(),
        vigenteHasta: r.vigenteHasta ? r.vigenteHasta.toISOString() : null,
        creadoPorNombre: r.creadoPorNombre,
        creadoPorApellido: r.creadoPorApellido,
      })),
    };
  },
});

export async function getReglasPrecio(): Promise<GetReglasPrecioOutput> {
  return getReglasPrecioQuery.execute({});
}
