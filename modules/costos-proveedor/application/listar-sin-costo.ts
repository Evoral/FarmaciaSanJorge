/**
 * `listarSinCosto` -- the "Sin precio" tab of `/costos-proveedor`
 * (openspec/specs/costos-proveedor/spec.md R38): lists drogas and materiales
 * of the tenant without any vigente costo de proveedor.
 *
 * Gated on `stock.valorizado.ver` (R35: the permiso that gates money everywhere else).
 * Hands back `puedeGestionar` (`costos.proveedor.gestionar`) so the UI knows whether
 * to link rows to `/costos-proveedor/nuevo`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { listSinCosto } from "../infrastructure/costo-proveedor-repository";
import type { ItemSinCosto } from "../infrastructure/costo-proveedor-repository";

/** Rows per page of the "Sin precio" list. */
export const PAGE_SIZE_SIN_COSTO = 20;

const tipoItemSchema = z.enum(["droga", "material", "todos"]);
export type TipoItemSinCosto = z.infer<typeof tipoItemSchema>;

const listarSinCostoInput = z.object({
  search: z.string().trim().optional(),
  tipo: tipoItemSchema.default("todos"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(PAGE_SIZE_SIN_COSTO),
});

export type ListarSinCostoInput = z.input<typeof listarSinCostoInput>;

export interface SinCostoResultado {
  items: ItemSinCosto[];
  total: number;
  page: number;
  pageSize: number;
  puedeGestionar: boolean;
}

export const listarSinCostoQuery = defineQuery({
  name: "costos-proveedor.listar-sin-costo",
  permiso: "stock.valorizado.ver",
  input: listarSinCostoInput,
  handler: async ({ tx, session, input }): Promise<SinCostoResultado> => {
    const lista = await listSinCosto(tx, session.tenantId, {
      search: input.search,
      tipo: input.tipo,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      ...lista,
      puedeGestionar: can(session, "costos.proveedor.gestionar"),
    };
  },
});

export async function listarSinCosto(input: ListarSinCostoInput): Promise<SinCostoResultado> {
  return listarSinCostoQuery.execute(input);
}
