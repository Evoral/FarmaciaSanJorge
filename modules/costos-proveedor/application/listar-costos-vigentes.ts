/**
 * `listarCostosVigentes` -- the "Vigentes" tab of `/costos-proveedor`
 * (openspec/specs/costos-proveedor/spec.md, "Interface"): one vigente costo per
 * (droga, proveedor), by droga name then proveedor, filtered by proveedor
 * and/or droga, paginated. Gated on `stock.valorizado.ver` (R35: the permiso
 * that gates money everywhere else).
 *
 * Also hands back what the screen needs and a client must not guess: the
 * jornada actual and time zone (the age of each price, the "desde" instant),
 * `puedeGestionar` (`costos.proveedor.gestionar`: whether the write actions are
 * shown -- the write use cases enforce it again), and the NAMES of the droga /
 * proveedor in the filter (the URL only carries opaque ids). With BOTH filters
 * the single result is the vigente costo of that pair, which is how the
 * manual form looks up "the costo the user is about to change".
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { uuid } from "@/shared/validation";
import {
  getContextoTemporal,
  getDrogasParaCosto,
  getProveedorParaCosto,
  listCostosVigentes,
} from "../infrastructure/costo-proveedor-repository";
import type { CostoProveedorListItem } from "../infrastructure/costo-proveedor-repository";

/** Rows per page of the "Vigentes" list. */
export const PAGE_SIZE_COSTOS_VIGENTES = 20;

const listarCostosVigentesInput = z.object({
  proveedorId: uuid.optional(),
  drogaId: uuid.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(PAGE_SIZE_COSTOS_VIGENTES),
});

export type ListarCostosVigentesInput = z.input<typeof listarCostosVigentesInput>;

export interface CostosVigentesResultado {
  items: CostoProveedorListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** `YYYY-MM-DD`: the pharmacy's today, to age each price. */
  jornadaActual: string;
  zonaHoraria: string;
  puedeGestionar: boolean;
  /** The droga / proveedor of the active filters, when they exist (a stale or foreign id yields `null`). */
  drogaFiltro: { id: string; nombre: string } | null;
  proveedorFiltro: { id: string; razonSocial: string } | null;
}

export const listarCostosVigentesQuery = defineQuery({
  name: "costos-proveedor.listar-vigentes",
  permiso: "stock.valorizado.ver",
  input: listarCostosVigentesInput,
  handler: async ({ tx, session, input }): Promise<CostosVigentesResultado> => {
    const contexto = await getContextoTemporal(tx, session.tenantId);
    const lista = await listCostosVigentes(tx, session.tenantId, input);
    const droga = input.drogaId ? (await getDrogasParaCosto(tx, session.tenantId, [input.drogaId])).get(input.drogaId) : undefined;
    const proveedor = input.proveedorId ? await getProveedorParaCosto(tx, session.tenantId, input.proveedorId) : null;
    return {
      ...lista,
      ...contexto,
      puedeGestionar: can(session, "costos.proveedor.gestionar"),
      drogaFiltro: droga ? { id: droga.id, nombre: droga.nombre } : null,
      proveedorFiltro: proveedor ? { id: proveedor.id, razonSocial: proveedor.razonSocial } : null,
    };
  },
});

export async function listarCostosVigentes(input: ListarCostosVigentesInput): Promise<CostosVigentesResultado> {
  return listarCostosVigentesQuery.execute(input);
}
