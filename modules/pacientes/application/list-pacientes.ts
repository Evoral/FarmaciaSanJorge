/**
 * `listPacientes` (M06, FASE 4 point 4.5). Read-only, gated on
 * `pacientes.gestionar` (plan §7: "pacientes.*"). HEALTH-ADJACENT DATA
 * (DP-24): the UI layer is responsible for never putting `search` in a
 * URL/query string (see app/(app)/pacientes/page.tsx's doc
 * comment) -- this query itself has no opinion on transport, only that the
 * caller already passed authorization.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listPacientes as listPacientesRepo } from "../infrastructure/paciente-repository";
import type { PacienteListItem as PacienteListItemRepo } from "../infrastructure/paciente-repository";
import { normalizarTelefonoWhatsappAR } from "../domain/recurrentes";

/**
 * A listed paciente plus the `wa.me` shortcut of the "WhatsApp" button (`null` when the teléfono is missing or not a
 * valid Argentine number). The raw teléfono is not sent to the client. Same deliberate exception as the recurrentes
 * view (domain/recurrentes.ts): an external link the person clicks, never logged or stored by this system.
 */
export type PacienteListItem = Omit<PacienteListItemRepo, "telefono"> & { whatsappUrl: string | null };

/** Own result type (built here, not re-exported from infrastructure) so modules/pacientes/ui/buscar-pacientes-action.ts derives its item type from the application layer (eslint.config.mjs's appBoundaryPatterns forbids reaching into infrastructure/ from any modules/**\/*.ts file, not just app/**). */
export interface ListPacientesResult {
  items: PacienteListItem[];
  total: number;
  page: number;
  pageSize: number;
}

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
  handler: async ({ tx, session, input }): Promise<ListPacientesResult> => {
    const result = await listPacientesRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      soloVigentes: input.soloVigentes,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      ...result,
      items: result.items.map(({ telefono, ...paciente }) => {
        const numero = normalizarTelefonoWhatsappAR(telefono);
        return { ...paciente, whatsappUrl: numero ? `https://wa.me/${numero}` : null };
      }),
    };
  },
});

export async function listPacientes(input: ListPacientesInput): Promise<ListPacientesResult> {
  return listPacientesQuery.execute(input);
}
