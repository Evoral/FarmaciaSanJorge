/**
 * `listPreparaciones` (M11, FASE 8 UI list -- pendientes/en curso/confirmadas).
 * FAR/DT: reuses `preparaciones.iniciar` (plan §7 has no dedicated read
 * permiso for this module -- both roles that may act on a preparación are
 * exactly the roles that hold `preparaciones.iniciar`; inventing a new
 * `preparaciones.ver` permiso code would need a migration inserting into
 * `fsj.permiso`'s seed, which the task scope does not call for).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listPreparaciones as listPreparacionesRepo } from "../infrastructure/preparacion-repository";
import type { PreparacionListItem } from "../infrastructure/preparacion-repository";

const ESTADOS = ["INICIADA", "CONFIRMADA", "DESCARTADA"] as const;

const listPreparacionesInput = z.object({
  estado: z.enum(ESTADOS).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export interface ListPreparacionesInput {
  estado?: (typeof ESTADOS)[number];
  page?: number;
  pageSize?: number;
}

export interface ListPreparacionesOutput {
  items: PreparacionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const listPreparacionesQuery = defineQuery({
  name: "preparaciones.listar",
  permiso: "preparaciones.iniciar",
  input: listPreparacionesInput,
  handler: async ({ tx, session, input }) => {
    const { items, total } = await listPreparacionesRepo(tx, {
      tenantId: session.tenantId,
      estado: input.estado,
      page: input.page,
      pageSize: input.pageSize,
    });
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
});

export async function listPreparaciones(input: ListPreparacionesInput = {}): Promise<ListPreparacionesOutput> {
  return listPreparacionesQuery.execute(input);
}
