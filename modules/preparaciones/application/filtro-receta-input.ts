/**
 * The /recetas filters every /preparaciones tab also offers (paciente, médico,
 * pago, ingreso and prescripción ranges -- domain/listado.ts), validated the
 * same way as /recetas' `listRecetas` input. Shared by the three list queries.
 */
import { z } from "zod";
import { FILTROS_PAGO_RECETA } from "@/modules/recetas/domain/pago";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

export const filtroRecetaInput = {
  paciente: z.string().trim().max(100).optional(),
  medico: z.string().trim().max(100).optional(),
  pago: z.enum(FILTROS_PAGO_RECETA).optional(),
  ingresoDesde: isoDate.optional(),
  ingresoHasta: isoDate.optional(),
  prescripcionDesde: isoDate.optional(),
  prescripcionHasta: isoDate.optional(),
};

type FiltroRecetaInput = z.output<z.ZodObject<typeof filtroRecetaInput>>;

/** The parsed filters, as the repository's `FiltroRecetaPreparaciones` takes them. */
export function filtroReceta(input: FiltroRecetaInput): FiltroRecetaInput {
  return {
    paciente: input.paciente,
    medico: input.medico,
    pago: input.pago,
    ingresoDesde: input.ingresoDesde,
    ingresoHasta: input.ingresoHasta,
    prescripcionDesde: input.prescripcionDesde,
    prescripcionHasta: input.prescripcionHasta,
  };
}
