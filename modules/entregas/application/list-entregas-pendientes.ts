/** `listEntregasPendientes` -- `/entregas` (FASE 11 point 11.1/11.2). Recetas PREPARADA/LISTA_PARA_RETIRAR (listas para entregar) and ENVIADA_PEND_FIRMA (esperando firma). Gated on `entregas.registrar`, same list this permiso's action supports (same convention as recetas' `recetas.pendientes-fisica.listar`). */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listEntregasPendientes as listRepo } from "../infrastructure/entrega-repository";
import type { EntregaPendienteItem } from "../infrastructure/entrega-repository";

export type { EntregaPendienteItem };

const listEntregasPendientesInput = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListEntregasPendientesInput = z.infer<typeof listEntregasPendientesInput>;

export interface ListEntregasPendientesResult {
  items: EntregaPendienteItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const listEntregasPendientesQuery = defineQuery({
  name: "entregas.pendientes.listar",
  permiso: "entregas.registrar",
  input: listEntregasPendientesInput,
  handler: async ({ tx, session, input }): Promise<ListEntregasPendientesResult> => {
    const { items, total } = await listRepo(tx, { tenantId: session.tenantId, search: input.search, page: input.page, pageSize: input.pageSize });
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
});

export async function listEntregasPendientes(input: ListEntregasPendientesInput): Promise<ListEntregasPendientesResult> {
  return listEntregasPendientesQuery.execute(input);
}
