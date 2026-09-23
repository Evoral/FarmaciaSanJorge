/**
 * zod filter schemas for the libro recetario / contralor / histórico
 * queries (FASE 9, M12 points 9.1/9.3/9.4/9.5). Pure validation, no I/O --
 * composes `shared/validation`'s primitives the same way every other
 * module's list-query input does (e.g. `modules/drogas/application/list-drogas.ts`).
 */
import { z } from "zod";
import { uuid } from "@/shared/validation";

const fechaIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe tener el formato AAAA-MM-DD.");

/** `bigint` correlativo, accepted as a digit string (never `number`, to avoid precision loss for very large books). */
const numeroCorrelativo = z
  .string()
  .trim()
  .regex(/^\d+$/, "Debe ser un número entero positivo.")
  .transform((value) => BigInt(value));

const paginacion = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(20),
};

export const ESTADO_ASIENTO_FILTRO = ["VIGENTE", "ANULADO"] as const;

export const listAsientosRecetarioFiltro = z.object({
  fechaDesde: fechaIso.optional(),
  fechaHasta: fechaIso.optional(),
  numeroDesde: numeroCorrelativo.optional(),
  numeroHasta: numeroCorrelativo.optional(),
  estado: z.enum(ESTADO_ASIENTO_FILTRO).optional(),
  texto: z.string().trim().min(1).optional(),
  ...paginacion,
});

/** Post-`zod.parse` shape (numeroDesde/numeroHasta as `bigint`) -- what query handlers and repositories receive. */
export type ListAsientosRecetarioFiltro = z.infer<typeof listAsientosRecetarioFiltro>;
/** Pre-parse shape (numeroDesde/numeroHasta as digit strings, straight from a URL query param) -- what callers of the exported `listAsientosRecetario`/`exportarLibroDatos` wrapper functions pass in. */
export type ListAsientosRecetarioFiltroInput = z.input<typeof listAsientosRecetarioFiltro>;

/** Same shape as the list filter, without pagination -- exports walk every matching page internally (see `exportar-libro.ts`). */
export const exportarLibroFiltro = listAsientosRecetarioFiltro.omit({ page: true, pageSize: true });

export type ExportarLibroFiltro = z.infer<typeof exportarLibroFiltro>;
export type ExportarLibroFiltroInput = z.input<typeof exportarLibroFiltro>;

export const TIPO_LIBRO_CONTRALOR = ["PSICOTROPICO", "ESTUPEFACIENTE"] as const;

export const listContralorFiltro = z.object({
  tipoLibro: z.enum(TIPO_LIBRO_CONTRALOR).optional(),
  drogaId: uuid.optional(),
  fechaDesde: fechaIso.optional(),
  fechaHasta: fechaIso.optional(),
  ...paginacion,
});

export type ListContralorFiltro = z.infer<typeof listContralorFiltro>;

export const TIPO_LIBRO_HISTORICO = ["RECETARIO", "PSICOTROPICO", "ESTUPEFACIENTE"] as const;

export const listHistoricoFiltro = z.object({
  tipoLibro: z.enum(TIPO_LIBRO_HISTORICO).optional(),
  ...paginacion,
});

export type ListHistoricoFiltro = z.infer<typeof listHistoricoFiltro>;
