/** Cheap layout-banner summary (FASE 12 point 12.2, `archivo.destruccion.gestionar`) -- same fail-soft, count-only discipline as `modules/cierres/application/list-jornadas-pendientes.ts#resumenJornadasPendientes`. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getResumenDestruccion } from "../infrastructure/archivo-repository";

export interface ResumenDestruccion {
  cantidad: number;
}

export const resumenDestruccionQuery = defineQuery({
  name: "archivo.destruccion.resumenPendientes",
  permiso: "archivo.destruccion.gestionar",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<ResumenDestruccion> => {
    return getResumenDestruccion(tx, session.tenantId);
  },
});

export async function resumenDestruccion(): Promise<ResumenDestruccion> {
  return resumenDestruccionQuery.execute({});
}
