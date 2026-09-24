/**
 * zod filter schemas for the cierres history/report queries (FASE 10 points
 * 10.1/10.4). Pure validation, no I/O -- same composition discipline as
 * `modules/libro/domain/filtros.ts`.
 */
import { z } from "zod";

const fechaIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe tener el formato AAAA-MM-DD.");

export { fechaIso };

const paginacion = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(20),
};

export const listCierresFiltro = z.object({
  fechaDesde: fechaIso.optional(),
  fechaHasta: fechaIso.optional(),
  ...paginacion,
});

export type ListCierresFiltro = z.infer<typeof listCierresFiltro>;
export type ListCierresFiltroInput = z.input<typeof listCierresFiltro>;

/** Same shape, without pagination -- the report/export walk every matching row (bounded, see `reporte-cumplimiento.ts`). */
export const reporteCumplimientoFiltro = z.object({
  fechaDesde: fechaIso.optional(),
  fechaHasta: fechaIso.optional(),
});

export type ReporteCumplimientoFiltro = z.infer<typeof reporteCumplimientoFiltro>;
export type ReporteCumplimientoFiltroInput = z.input<typeof reporteCumplimientoFiltro>;
