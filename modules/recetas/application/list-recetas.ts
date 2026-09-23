/**
 * `listRecetas` (M09, FASE 6 point 6.6). Read-only, gated on `recetas.crear`
 * (see get-receta.ts's doc comment for why). Filters by estado, paciente,
 * médico, date range (fecha_prescripcion) and search by numero_interno.
 * Pagination and filters entirely server-side (no client-side slicing).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { ESTADOS_RECETA } from "../domain/receta";
import { listRecetas as listRecetasRepo } from "../infrastructure/receta-repository";
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
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listRecetas(input: ListRecetasInput): Promise<ListRecetasResult> {
  return listRecetasQuery.execute(input);
}
