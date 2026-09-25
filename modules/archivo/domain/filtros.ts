/**
 * zod filter/input schemas for FASE 12 (M15, points 12.1-12.3). Pure
 * validation, no I/O -- same "own copy per module" discipline as
 * `modules/cierres/domain/filtros.ts`/`modules/libro/domain/filtros.ts`.
 */
import { z } from "zod";
import { ESTADOS_LOTE_ARCHIVO } from "./lote-archivo";

export const fechaIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe tener el formato AAAA-MM-DD.");

const paginacion = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(20),
};

export const periodoLote = z
  .object({
    periodoDesde: fechaIso,
    periodoHasta: fechaIso,
  })
  .refine((v) => v.periodoHasta >= v.periodoDesde, {
    message: "El período hasta no puede ser anterior al período desde.",
    path: ["periodoHasta"],
  });

export const listRecetasElegiblesInput = periodoLote;
export type ListRecetasElegiblesInput = z.infer<typeof listRecetasElegiblesInput>;

export const conformarLoteInput = z
  .object({
    periodoDesde: fechaIso,
    periodoHasta: fechaIso,
    ubicacion: z.string().trim().min(1, "La ubicación es obligatoria.").max(200),
  })
  .refine((v) => v.periodoHasta >= v.periodoDesde, {
    message: "El período hasta no puede ser anterior al período desde.",
    path: ["periodoHasta"],
  });
export type ConformarLoteInput = z.infer<typeof conformarLoteInput>;

export const listLotesFiltro = z.object({
  estado: z.enum(ESTADOS_LOTE_ARCHIVO).optional(),
  periodoDesde: fechaIso.optional(),
  periodoHasta: fechaIso.optional(),
  ...paginacion,
});
export type ListLotesFiltro = z.infer<typeof listLotesFiltro>;
export type ListLotesFiltroInput = z.input<typeof listLotesFiltro>;

export const loteIdInput = z.object({ id: z.string().uuid() });

export const solicitarDestruccionInput = z.object({
  id: z.string().uuid(),
  password: z.string().min(1, "Ingresá tu contraseña."),
});

export const autorizarDestruccionInput = z.object({
  id: z.string().uuid(),
  expedienteAutorizacion: z.string().trim().min(1, "El número de expediente es obligatorio.").max(200),
  fechaAutorizacion: fechaIso,
  password: z.string().min(1, "Ingresá tu contraseña."),
});

export const registrarDestruccionInput = z.object({
  id: z.string().uuid(),
  fechaDestruccion: fechaIso,
  password: z.string().min(1, "Ingresá tu contraseña."),
});
