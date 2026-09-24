/**
 * `listRegularizacion` -- `/regularizacion` (FASE 11 point 11.3, DP-15,
 * INV-R10). Gated on `regularizacion.ver`. `antiguedadDias`/`vencida` are
 * computed IN SQL from the tenant's own jornada (`fsj.jornada_actual`,
 * migration 0018) -- see `modules/entregas/infrastructure/entrega-repository.ts#listRegularizacion`
 * -- never `Date.now()`/`jornadaDe()`'s JS default (Mendoza tz), which
 * would be wrong for a tenant in a different zona_horaria.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { esVencidaRegularizacion } from "../domain/entrega";
import { listRegularizacion as listRepo, getPlazoRegularizacionDias, getResumenRegularizacion } from "../infrastructure/entrega-repository";

const listRegularizacionInput = z.object({
  soloVencidas: z.boolean().optional().default(false),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListRegularizacionInput = z.infer<typeof listRegularizacionInput>;

export interface RegularizacionListItem {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  estado: string;
  fechaAsientoMasAntiguo: string;
  antiguedadDias: number;
  vencida: boolean;
}

export interface ListRegularizacionResult {
  items: RegularizacionListItem[];
  total: number;
  page: number;
  pageSize: number;
  plazoRegularizacionDias: number;
}

export const listRegularizacionQuery = defineQuery({
  name: "regularizacion.listar",
  permiso: "regularizacion.ver",
  input: listRegularizacionInput,
  handler: async ({ tx, session, input }): Promise<ListRegularizacionResult> => {
    const plazoRegularizacionDias = await getPlazoRegularizacionDias(tx, session.tenantId);
    const { items, total } = await listRepo(tx, {
      tenantId: session.tenantId,
      soloVencidas: input.soloVencidas,
      plazoRegularizacionDias,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
    });

    return {
      items: items.map((i) => ({ ...i, vencida: esVencidaRegularizacion(i.antiguedadDias, plazoRegularizacionDias) })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      plazoRegularizacionDias,
    };
  },
});

export async function listRegularizacion(input: ListRegularizacionInput): Promise<ListRegularizacionResult> {
  return listRegularizacionQuery.execute(input);
}

/** Cheap summary for the layout banner (FASE 11 point 11.3's "N recetas pendientes de regularizar (M vencidas)"). Same permiso, no pagination. */
export interface ResumenRegularizacion {
  cantidad: number;
  vencidas: number;
}

export const resumenRegularizacionQuery = defineQuery({
  name: "regularizacion.resumen",
  permiso: "regularizacion.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<ResumenRegularizacion> => {
    const plazoRegularizacionDias = await getPlazoRegularizacionDias(tx, session.tenantId);
    return getResumenRegularizacion(tx, session.tenantId, plazoRegularizacionDias);
  },
});

export async function resumenRegularizacion(): Promise<ResumenRegularizacion> {
  return resumenRegularizacionQuery.execute({});
}
