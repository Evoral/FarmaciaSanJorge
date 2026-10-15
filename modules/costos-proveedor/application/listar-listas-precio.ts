/**
 * `listarListasPrecio` -- the "Listas importadas" tab of `/costos-proveedor`
 * (docs/specs/costos-proveedor.md, "Interface" 3): every imported supplier price list, newest
 * first, optionally filtered by proveedor, paginated. Gated on `stock.valorizado.ver` (R35: the
 * permiso that gates money everywhere else; consulting is not the same as importing).
 *
 * Also hands back what the screen needs and a client must not guess: the pharmacy's time zone (the
 * "registrado el" instant is shown as ITS calendar day) and the NAME of the proveedor in the filter
 * (the URL only carries an opaque id).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getContextoTemporal, getProveedorParaCosto, listListasPrecio } from "../infrastructure/costo-proveedor-repository";
import type { ListaPrecioListItem } from "../infrastructure/costo-proveedor-repository";

/** Rows per page of the "Listas importadas" list. */
export const PAGE_SIZE_LISTAS_PRECIO = 20;

const listarListasPrecioInput = z.object({
  proveedorId: uuid.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(PAGE_SIZE_LISTAS_PRECIO),
});

export type ListarListasPrecioInput = z.input<typeof listarListasPrecioInput>;

export interface ListasPrecioResultado {
  items: ListaPrecioListItem[];
  total: number;
  page: number;
  pageSize: number;
  zonaHoraria: string;
  /** The proveedor of the active filter, when it exists (a stale or foreign id yields `null`). */
  proveedorFiltro: { id: string; razonSocial: string } | null;
}

export const listarListasPrecioQuery = defineQuery({
  name: "costos-proveedor.listar-listas",
  permiso: "stock.valorizado.ver",
  input: listarListasPrecioInput,
  handler: async ({ tx, session, input }): Promise<ListasPrecioResultado> => {
    const { zonaHoraria } = await getContextoTemporal(tx, session.tenantId);
    const lista = await listListasPrecio(tx, session.tenantId, input);
    const proveedor = input.proveedorId ? await getProveedorParaCosto(tx, session.tenantId, input.proveedorId) : null;
    return { ...lista, zonaHoraria, proveedorFiltro: proveedor ? { id: proveedor.id, razonSocial: proveedor.razonSocial } : null };
  },
});

export async function listarListasPrecio(input: ListarListasPrecioInput): Promise<ListasPrecioResultado> {
  return listarListasPrecioQuery.execute(input);
}
