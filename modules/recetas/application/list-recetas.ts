/**
 * `listRecetas` (M09, FASE 6 point 6.6). Read-only, gated on `recetas.crear`
 * (see get-receta.ts's doc comment for why). Filters by estado, paciente,
 * médico, date ranges (fecha_prescripcion and fecha_ingreso) and search by
 * numero_interno.
 * Pagination and filters entirely server-side (no client-side slicing).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { inicioDeJornada, jornadaDe } from "@/shared/time/jornada";
import { ESTADOS_RECETA } from "../domain/receta";
import { PERIODOS_RESUMEN, inicioDePeriodo, type PeriodoResumen } from "../domain/periodo-resumen";
import { listRecetas as listRecetasRepo, countRecetasPorEstado, zonaHorariaTenant } from "../infrastructure/receta-repository";
import type { ListRecetasResult } from "../infrastructure/receta-repository";

export type { ListRecetasResult };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

const listRecetasInput = z.object({
  estado: z.enum(ESTADOS_RECETA).optional(),
  pacienteId: uuid.optional(),
  medicoId: uuid.optional(),
  numeroInterno: z.string().trim().optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  ingresoDesde: isoDate.optional(),
  ingresoHasta: isoDate.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListRecetasInput = z.infer<typeof listRecetasInput>;

export const listRecetasQuery = defineQuery({
  name: "recetas.listar",
  permiso: "recetas.crear",
  input: listRecetasInput,
  handler: async ({ tx, session, input }) => {
    return listRecetasRepo(tx, {
      tenantId: session.tenantId,
      estado: input.estado,
      pacienteId: input.pacienteId,
      medicoId: input.medicoId,
      numeroInterno: input.numeroInterno,
      desde: input.desde,
      hasta: input.hasta,
      ingresoDesde: input.ingresoDesde,
      ingresoHasta: input.ingresoHasta,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listRecetas(input: ListRecetasInput): Promise<ListRecetasResult> {
  return listRecetasQuery.execute(input);
}

/**
 * Cheap counts-by-estado summary for the home dashboard and `/recetas`
 * (FASE 13 point 13.1, user decision 1: "recetas por estado counts (recetas
 * read permiso used by /recetas)") -- same permiso as `listRecetasQuery`
 * (`recetas.crear`), deliberately NOT `reportes.ver` (that's the separate
 * recetas report at `/reportes/recetas` and its CSV export, gated
 * differently -- see `modules/recetas/application/reporte-recetas.ts`).
 */
export interface ResumenRecetasPorEstado {
  estado: (typeof ESTADOS_RECETA)[number];
  cantidad: number;
}

/**
 * `periodo` limits the counts to recetas that entered (fecha_ingreso) within
 * that window ending today, in the farmacia's time zone. Defaults to
 * "todos" so the home dashboard keeps its all-time counts; `/recetas`
 * passes its own window (default last 30 days).
 */
export const resumenRecetasPorEstadoQuery = defineQuery({
  name: "recetas.resumenPorEstado",
  permiso: "recetas.crear",
  input: z.object({ periodo: z.enum(PERIODOS_RESUMEN).default("todos") }),
  handler: async ({ tx, session, input }): Promise<ResumenRecetasPorEstado[]> => {
    let ingresoDesde: Date | undefined;
    if (input.periodo !== "todos") {
      const zonaHoraria = await zonaHorariaTenant(tx, session.tenantId);
      const desde = inicioDePeriodo(input.periodo, jornadaDe(new Date(), zonaHoraria));
      ingresoDesde = desde ? inicioDeJornada(desde, zonaHoraria) : undefined;
    }
    const rows = await countRecetasPorEstado(tx, session.tenantId, ingresoDesde);
    const porEstado = new Map(rows.map((r) => [r.estado, r.cantidad]));
    return ESTADOS_RECETA.map((estado) => ({ estado, cantidad: porEstado.get(estado) ?? 0 }));
  },
});

export async function resumenRecetasPorEstado(periodo?: PeriodoResumen): Promise<ResumenRecetasPorEstado[]> {
  return resumenRecetasPorEstadoQuery.execute({ periodo });
}
