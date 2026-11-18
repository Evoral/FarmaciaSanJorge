/**
 * `listarCostosVigentes` -- the "Vigentes" tab of `/costos-proveedor`
 * (openspec/specs/costos-proveedor/spec.md, "Interface"): one vigente costo per
 * (droga, proveedor), by droga name then proveedor, filtered by proveedor,
 * droga, fecha del precio, origen and "sin actualizar" (R39), paginated. Gated on `stock.valorizado.ver` (R35: the permiso
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
import { fechaIso, uuid } from "@/shared/validation";
import { fechaLimiteDesactualizado } from "../domain/presentacion";
import {
  getAlicuotaIvaPorDefecto,
  getContextoTemporal,
  getDrogasParaCosto,
  getProveedorParaCosto,
  listCostosVigentes,
} from "../infrastructure/costo-proveedor-repository";
import type { CostoProveedorListItem } from "../infrastructure/costo-proveedor-repository";

/** Rows per page of the "Vigentes" list. */
export const PAGE_SIZE_COSTOS_VIGENTES = 20;

/** Values of the origen filter (R39); the page parses its searchParam against this list. */
export const ORIGENES_COSTO = ["todos", "manual", "lista"] as const;
export type OrigenCostoFiltro = (typeof ORIGENES_COSTO)[number];

const listarCostosVigentesInput = z.object({
  proveedorId: uuid.optional(),
  drogaId: uuid.optional(),
  /** R39: inclusive range on the fecha del precio. */
  fechaDesde: fechaIso.optional(),
  fechaHasta: fechaIso.optional(),
  origen: z.enum(ORIGENES_COSTO).default("todos"),
  /** R39: only the prices not updated in a year. */
  soloDesactualizados: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(PAGE_SIZE_COSTOS_VIGENTES),
});

export type ListarCostosVigentesInput = z.input<typeof listarCostosVigentesInput>;

export interface CostosVigentesResultado {
  items: CostoProveedorListItem[];
  total: number;
  /** R39: vigentes matching the other filters whose price was not updated in a year. */
  totalDesactualizados: number;
  page: number;
  pageSize: number;
  /** `YYYY-MM-DD`: the pharmacy's today, to age each price. */
  jornadaActual: string;
  zonaHoraria: string;
  puedeGestionar: boolean;
  /** R7a: the tenant's `alicuota_iva_porcentaje`, what a new costo starts with in the manual form. */
  alicuotaIvaPorDefecto: string;
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
    const lista = await listCostosVigentes(tx, session.tenantId, {
      ...input,
      origen: input.origen === "todos" ? undefined : input.origen,
      limiteDesactualizado: fechaLimiteDesactualizado(contexto.jornadaActual),
    });
    const droga = input.drogaId ? (await getDrogasParaCosto(tx, session.tenantId, [input.drogaId])).get(input.drogaId) : undefined;
    const proveedor = input.proveedorId ? await getProveedorParaCosto(tx, session.tenantId, input.proveedorId) : null;
    return {
      ...lista,
      ...contexto,
      puedeGestionar: can(session, "costos.proveedor.gestionar"),
      alicuotaIvaPorDefecto: await getAlicuotaIvaPorDefecto(tx, session.tenantId),
      drogaFiltro: droga ? { id: droga.id, nombre: droga.nombre } : null,
      proveedorFiltro: proveedor ? { id: proveedor.id, razonSocial: proveedor.razonSocial } : null,
    };
  },
});

export async function listarCostosVigentes(input: ListarCostosVigentesInput): Promise<CostosVigentesResultado> {
  return listarCostosVigentesQuery.execute(input);
}
