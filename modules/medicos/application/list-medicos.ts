/**
 * `listMedicos` (M06, FASE 4 point 4.4). Read-only, gated on the same
 * single `medicos.gestionar` permiso as every other action in this module
 * (plan §7: "medicos.*"). Search matches apellido/matrícula (plan §9 M06:
 * "Búsqueda por matrícula/apellido").
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listMedicos as listMedicosRepo } from "../infrastructure/medico-repository";
import type { ListMedicosResult } from "../infrastructure/medico-repository";

const listMedicosInput = z.object({
  search: z.string().trim().optional(),
  soloVigentes: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListMedicosInput = z.infer<typeof listMedicosInput>;

export const listMedicosQuery = defineQuery({
  name: "medicos.listar",
  permiso: "medicos.gestionar",
  input: listMedicosInput,
  handler: async ({ tx, session, input }) => {
    return listMedicosRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      soloVigentes: input.soloVigentes,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listMedicos(input: ListMedicosInput): Promise<ListMedicosResult> {
  return listMedicosQuery.execute(input);
}
