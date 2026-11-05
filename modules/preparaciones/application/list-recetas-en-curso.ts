/**
 * `listRecetasEnCurso` (M11): the /preparaciones "En curso" tab -- recetas
 * the lab took (domain/toma.ts, migration 0057) that still have ítems to
 * confirm, oldest toma first (rule:
 * modules/preparaciones/infrastructure/preparacion-repository.ts#listRecetasEnCursoSql).
 * Each row opens the receta's toma workspace. Also the home dashboard's
 * "Recetas en curso" count.
 *
 * Same permiso as the other lists (`preparaciones.iniciar`). Filters are
 * applied in the query: receta number, the toma's date range (the
 * tenant's calendar days) and the /recetas filters (filtro-receta-input.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { fechaIso } from "@/shared/validation";
import { filtroReceta, filtroRecetaInput } from "./filtro-receta-input";
import { listRecetasEnCurso as listRecetasEnCursoRepo } from "../infrastructure/preparacion-repository";
import type { RecetaEnCursoFila } from "../infrastructure/preparacion-repository";

export type { RecetaEnCursoFila };

const listRecetasEnCursoInput = z.object({
  numeroInterno: z.string().trim().regex(/^\d{1,18}$/, "Debe ser un número de receta.").optional(),
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  ...filtroRecetaInput,
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type ListRecetasEnCursoInput = z.input<typeof listRecetasEnCursoInput>;

export interface ListRecetasEnCursoOutput {
  items: RecetaEnCursoFila[];
  total: number;
  page: number;
  pageSize: number;
  /** For "Tomada" (a timestamp) as the farmacia's local time. */
  zonaHoraria: string;
}

export const listRecetasEnCursoQuery = defineQuery({
  name: "preparaciones.listarEnCurso",
  permiso: "preparaciones.iniciar",
  input: listRecetasEnCursoInput,
  handler: async ({ tx, session, input }): Promise<ListRecetasEnCursoOutput> => {
    const { items, total, zonaHoraria } = await listRecetasEnCursoRepo(tx, {
      tenantId: session.tenantId,
      numeroInterno: input.numeroInterno,
      desde: input.desde,
      hasta: input.hasta,
      ...filtroReceta(input),
      page: input.page,
      pageSize: input.pageSize,
    });
    return { items, total, page: input.page, pageSize: input.pageSize, zonaHoraria };
  },
});

export async function listRecetasEnCurso(input: ListRecetasEnCursoInput = {}): Promise<ListRecetasEnCursoOutput> {
  return listRecetasEnCursoQuery.execute(input);
}
