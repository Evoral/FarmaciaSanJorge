/**
 * `listPacientes` (M06, FASE 4 point 4.5). Read-only, gated on
 * `pacientes.gestionar` (plan §7: "pacientes.*"). HEALTH-ADJACENT DATA
 * (DP-24): the UI layer is responsible for never putting `search` in a
 * URL/query string (see app/(app)/catalogos/pacientes/page.tsx's doc
 * comment) -- this query itself has no opinion on transport, only that the
 * caller already passed authorization.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listPacientes as listPacientesRepo } from "../infrastructure/paciente-repository";
import type { ListPacientesResult } from "../infrastructure/paciente-repository";

/** Re-exported (unlike modules/proveedores/application/list-proveedores.ts's own `ListProveedoresResult` import) so modules/pacientes/ui/buscar-pacientes-action.ts can derive its item type from the application layer's result shape instead of reaching into infrastructure/ directly (eslint.config.mjs's appBoundaryPatterns forbids that from any modules/**\/*.ts file, not just app/**). */
export type { ListPacientesResult };

const listPacientesInput = z.object({
  search: z.string().trim().optional(),
  soloVigentes: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListPacientesInput = z.infer<typeof listPacientesInput>;

export const listPacientesQuery = defineQuery({
  name: "pacientes.listar",
  permiso: "pacientes.gestionar",
  input: listPacientesInput,
  handler: async ({ tx, session, input }) => {
    return listPacientesRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      soloVigentes: input.soloVigentes,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listPacientes(input: ListPacientesInput): Promise<ListPacientesResult> {
  return listPacientesQuery.execute(input);
}
