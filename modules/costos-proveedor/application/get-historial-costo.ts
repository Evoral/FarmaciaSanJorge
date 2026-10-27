/**
 * `getHistorialCosto` -- every version of one (droga, proveedor) pair, newest
 * first, for `/costos-proveedor/historial?droga=&proveedor=` (openspec/specs/
 * costos-proveedor/spec.md, "Interface" 4). Gated on `stock.valorizado.ver` (R35).
 *
 * Returns `null` when the droga or the proveedor is not one of the tenant's
 * (the page answers 404). Each version carries its state: `VIGENTE`,
 * `REEMPLAZADO` (another version starts where it ended) or `BAJA` (closed with
 * no successor, R11) -- with the baja's motivo, which only the audit trail
 * keeps (`bajaMotivo`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { uuid } from "@/shared/validation";
import { clasificarVersiones } from "../domain/presentacion";
import type { EstadoVersionCosto } from "../domain/presentacion";
import {
  getContextoTemporal,
  getDrogasParaCosto,
  getProveedorParaCosto,
  getUnidadesParaCosto,
  listHistorialCosto,
} from "../infrastructure/costo-proveedor-repository";
import type { HistorialCostoItem } from "../infrastructure/costo-proveedor-repository";

const getHistorialCostoInput = z.object({
  drogaId: uuid,
  proveedorId: uuid,
});

export type GetHistorialCostoInput = z.input<typeof getHistorialCostoInput>;

export interface VersionCostoHistorial extends HistorialCostoItem {
  estado: EstadoVersionCosto;
}

export interface HistorialCostoResultado {
  droga: { id: string; nombre: string; unidadBaseSimbolo: string };
  proveedor: { id: string; razonSocial: string; deBaja: boolean };
  /** Newest first; the vigente one (if any) on top. */
  versiones: VersionCostoHistorial[];
  /** The vigente version's id, `null` when the pair has none (never loaded, or given de baja). */
  vigenteId: string | null;
  jornadaActual: string;
  zonaHoraria: string;
  puedeGestionar: boolean;
}

export const getHistorialCostoQuery = defineQuery({
  name: "costos-proveedor.historial",
  permiso: "stock.valorizado.ver",
  input: getHistorialCostoInput,
  handler: async ({ tx, session, input }): Promise<HistorialCostoResultado | null> => {
    const droga = (await getDrogasParaCosto(tx, session.tenantId, [input.drogaId])).get(input.drogaId);
    const proveedor = await getProveedorParaCosto(tx, session.tenantId, input.proveedorId);
    if (!droga || !proveedor) return null;

    const unidadBase = (await getUnidadesParaCosto(tx, [droga.unidadBaseId])).get(droga.unidadBaseId);
    const contexto = await getContextoTemporal(tx, session.tenantId);
    const historial = await listHistorialCosto(tx, session.tenantId, input.drogaId, input.proveedorId);
    const estados = clasificarVersiones(historial);
    const versiones = historial.map((version) => ({ ...version, estado: estados.get(version.id) ?? "REEMPLAZADO" }));

    return {
      droga: { id: droga.id, nombre: droga.nombre, unidadBaseSimbolo: unidadBase?.simbolo ?? "" },
      proveedor: { id: proveedor.id, razonSocial: proveedor.razonSocial, deBaja: proveedor.fechaBaja !== null },
      versiones,
      vigenteId: versiones.find((version) => version.estado === "VIGENTE")?.id ?? null,
      ...contexto,
      puedeGestionar: can(session, "costos.proveedor.gestionar"),
    };
  },
});

export async function getHistorialCosto(input: GetHistorialCostoInput): Promise<HistorialCostoResultado | null> {
  return getHistorialCostoQuery.execute(input);
}
