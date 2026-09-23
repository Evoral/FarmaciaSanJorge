/**
 * `getCotizacionItem` (M10, FASE 7 point 7.4). ATP, FAR, DT (plan §7:
 * `cotizaciones.ver`). Returns the item's vigente cotizacion (INV-R06:
 * max `calculadaEn`) plus the full history -- both are read directly from
 * `fsj.cotizacion`, which is insert-only (migration 0031), so "historial"
 * is simply every row ever inserted for this item.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getCotizacionVigente, listHistorialCotizaciones } from "../infrastructure/cotizacion-repository";
import type { CotizacionDetalle } from "../domain/calcular-cotizacion";

const getCotizacionItemInput = z.object({ itemRecetaId: uuid });

export interface GetCotizacionItemInput {
  itemRecetaId: string;
}

export interface CotizacionItemOutput {
  id: string;
  costoInsumos: string;
  margenAplicado: string;
  precioFinal: string;
  esParcial: boolean;
  esIncompleta: boolean;
  detalle: CotizacionDetalle;
  calculadaEn: string;
  calculadaPorNombre: string;
  calculadaPorApellido: string;
}

export interface GetCotizacionItemOutput {
  vigente: CotizacionItemOutput | null;
  historial: CotizacionItemOutput[];
}

function toOutput(row: {
  id: string;
  costoInsumos: string;
  margenAplicado: string;
  precioFinal: string;
  esParcial: boolean;
  esIncompleta: boolean;
  detalle: unknown;
  calculadaEn: Date;
  calculadaPorNombre: string;
  calculadaPorApellido: string;
}): CotizacionItemOutput {
  return {
    id: row.id,
    costoInsumos: row.costoInsumos,
    margenAplicado: row.margenAplicado,
    precioFinal: row.precioFinal,
    esParcial: row.esParcial,
    esIncompleta: row.esIncompleta,
    detalle: row.detalle as CotizacionDetalle,
    calculadaEn: row.calculadaEn.toISOString(),
    calculadaPorNombre: row.calculadaPorNombre,
    calculadaPorApellido: row.calculadaPorApellido,
  };
}

export const getCotizacionItemQuery = defineQuery({
  name: "cotizaciones.item.consultar",
  permiso: "cotizaciones.ver",
  input: getCotizacionItemInput,
  handler: async ({ tx, session, input }) => {
    const [vigente, historial] = await Promise.all([
      getCotizacionVigente(tx, session.tenantId, input.itemRecetaId),
      listHistorialCotizaciones(tx, session.tenantId, input.itemRecetaId),
    ]);

    return {
      vigente: vigente ? toOutput(vigente) : null,
      historial: historial.map(toOutput),
    };
  },
});

export async function getCotizacionItem(input: GetCotizacionItemInput): Promise<GetCotizacionItemOutput> {
  return getCotizacionItemQuery.execute(input);
}
