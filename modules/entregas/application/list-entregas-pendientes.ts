/** `listEntregasPendientes` -- `/entregas` (FASE 11 point 11.1/11.2). Recetas PREPARADA (listas para entregar) and ENVIADA_PEND_FIRMA (esperando retorno); RETIRO_VENCIDO only when filtered by it (docs/specs/retiro-vencido.md). Gated on `entregas.registrar`, same list this permiso's action supports. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { ESTADOS_FILTRO_ENTREGAS } from "../domain/entrega";
import { listEntregasPendientes as listRepo } from "../infrastructure/entrega-repository";
import type { EntregaPendienteItem } from "../infrastructure/entrega-repository";

export type { EntregaPendienteItem };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

const listEntregasPendientesInput = z.object({
  search: z.string().trim().max(200).optional(),
  estado: z.enum(ESTADOS_FILTRO_ENTREGAS).optional(),
  numeroInterno: z.string().trim().max(20).optional(),
  ingresoDesde: isoDate.optional(),
  ingresoHasta: isoDate.optional(),
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
    const { items, total } = await listRepo(tx, { tenantId: session.tenantId, search: input.search, estado: input.estado, numeroInterno: input.numeroInterno, ingresoDesde: input.ingresoDesde, ingresoHasta: input.ingresoHasta, page: input.page, pageSize: input.pageSize, conPrecio: can(session, "cotizaciones.ver") });
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
});

export async function listEntregasPendientes(input: ListEntregasPendientesInput): Promise<ListEntregasPendientesResult> {
  return listEntregasPendientesQuery.execute(input);
}
