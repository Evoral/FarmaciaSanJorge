/**
 * `listRecetasPendientesFisica` (M09, FASE 6 point 6.6, INV-R10). Gated on
 * `recetas.fisica.registrar` (same role set as `recetas.crear` -- ATP/FAR/DT
 * -- but semantically tied to the action this list exists to support).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listRecetasPendientesFisica as listRepo } from "../infrastructure/receta-repository";

const input = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListRecetasPendientesFisicaInput = z.infer<typeof input>;

export const listRecetasPendientesFisicaQuery = defineQuery({
  name: "recetas.pendientes-fisica.listar",
  permiso: "recetas.fisica.registrar",
  input,
  handler: async ({ tx, session, input: parsed }) => listRepo(tx, session.tenantId, parsed.page, parsed.pageSize),
});

export async function listRecetasPendientesFisica(parsed: ListRecetasPendientesFisicaInput) {
  return listRecetasPendientesFisicaQuery.execute(parsed);
}
