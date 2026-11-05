/**
 * `listRecetasPendientes` (M11): the /preparaciones "Pendientes" tab, the
 * lab's queue -- one row per receta nobody took yet that still has ítems
 * needing a preparación, oldest first so none is skipped (rule and order:
 * modules/preparaciones/infrastructure/preparacion-repository.ts#listRecetasPendientesSql).
 * Each row is taken with `preparaciones.tomarReceta` (domain/toma.ts).
 *
 * Same permiso as the other lists (`preparaciones.iniciar`: the queue is
 * only useful to whoever may take from it). Filters are applied in the
 * query (server-side): receta number, the receta's ingreso date range
 * (the tenant's calendar days) and the /recetas filters
 * (filtro-receta-input.ts; its ingreso range is not offered on this tab).
 *
 * Each row also carries what has to be prepared (the "Ver" preview): its
 * pending ítems with their cantidades/posología and componentes -- read for
 * the whole page in two batched queries (ítems, then componentes), no N+1.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { fechaIso } from "@/shared/validation";
import { filtroReceta, filtroRecetaInput } from "./filtro-receta-input";
import {
  listComponentesDePendientes,
  listItemsPendientesDeRecetas,
  listRecetasPendientes as listRecetasPendientesRepo,
} from "../infrastructure/preparacion-repository";
import type { ComponenteDePendiente, ItemPendienteFila, RecetaPendienteFila } from "../infrastructure/preparacion-repository";

export type { ComponenteDePendiente };

export interface ItemPendiente extends ItemPendienteFila {
  /** In `ordenarComponentes` order; empty when the ítem has none. */
  componentes: ComponenteDePendiente[];
}

export interface RecetaPendienteItem extends RecetaPendienteFila {
  /** The receta's ítems still needing a preparación, in detail-page order. */
  items: ItemPendiente[];
}

const listRecetasPendientesInput = z.object({
  numeroInterno: z.string().trim().regex(/^\d{1,18}$/, "Debe ser un número de receta.").optional(),
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  ...filtroRecetaInput,
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type ListRecetasPendientesInput = z.input<typeof listRecetasPendientesInput>;

export interface ListRecetasPendientesOutput {
  items: RecetaPendienteItem[];
  total: number;
  page: number;
  pageSize: number;
  /** For "Ingresada" (the receta's `fecha_ingreso`, a timestamp) as the farmacia's calendar day. */
  zonaHoraria: string;
}

export const listRecetasPendientesQuery = defineQuery({
  name: "preparaciones.listarPendientes",
  permiso: "preparaciones.iniciar",
  input: listRecetasPendientesInput,
  handler: async ({ tx, session, input }): Promise<ListRecetasPendientesOutput> => {
    const { items: recetas, total, zonaHoraria } = await listRecetasPendientesRepo(tx, {
      tenantId: session.tenantId,
      numeroInterno: input.numeroInterno,
      desde: input.desde,
      hasta: input.hasta,
      ...filtroReceta(input),
      page: input.page,
      pageSize: input.pageSize,
    });
    const itemsPorReceta = await listItemsPendientesDeRecetas(
      tx,
      session.tenantId,
      recetas.map((r) => r.recetaId),
    );
    const componentes = await listComponentesDePendientes(
      tx,
      session.tenantId,
      [...itemsPorReceta.values()].flat().map((item) => item.itemRecetaId),
    );
    return {
      items: recetas.map((receta) => ({
        ...receta,
        items: (itemsPorReceta.get(receta.recetaId) ?? []).map((item) => ({ ...item, componentes: componentes.get(item.itemRecetaId) ?? [] })),
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      zonaHoraria,
    };
  },
});

export async function listRecetasPendientes(input: ListRecetasPendientesInput = {}): Promise<ListRecetasPendientesOutput> {
  return listRecetasPendientesQuery.execute(input);
}
