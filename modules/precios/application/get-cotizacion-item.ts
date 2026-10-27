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
import { leerDetalleCotizacion } from "../domain/calcular-cotizacion";
import type { CotizacionDetalle, CotizacionDetalleLeido } from "../domain/calcular-cotizacion";

const getCotizacionItemInput = z.object({ itemRecetaId: uuid });

export interface GetCotizacionItemInput {
  itemRecetaId: string;
}

export interface CotizacionItemOutput {
  id: string;
  /** Net of IVA. */
  costoInsumos: string;
  /** R7a: the base the price was calculated on. `null` = calculated before migration 0107 (priced without IVA). */
  costoInsumosConIva: string | null;
  margenAplicado: string;
  /** The regla's precio mínimo raised the price (migration 0052; always false before it). */
  precioMinimoAplicado: boolean;
  precioFinal: string;
  esParcial: boolean;
  esIncompleta: boolean;
  /** The stored detalle, read per R32: every línea has a `fuente` (a snapshot without one is `PARTIDAS`, flagged `fuenteRegistrada: false`). */
  detalle: CotizacionDetalleLeido;
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
  costoInsumosConIva: string | null;
  margenAplicado: string;
  precioMinimoAplicado: boolean;
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
    costoInsumosConIva: row.costoInsumosConIva,
    margenAplicado: row.margenAplicado,
    precioMinimoAplicado: row.precioMinimoAplicado,
    precioFinal: row.precioFinal,
    esParcial: row.esParcial,
    esIncompleta: row.esIncompleta,
    detalle: leerDetalleCotizacion(row.detalle as CotizacionDetalle),
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
    const vigente = await getCotizacionVigente(tx, session.tenantId, input.itemRecetaId);
    const historial = await listHistorialCotizaciones(tx, session.tenantId, input.itemRecetaId);

    return {
      vigente: vigente ? toOutput(vigente) : null,
      historial: historial.map(toOutput),
    };
  },
});

export async function getCotizacionItem(input: GetCotizacionItemInput): Promise<GetCotizacionItemOutput> {
  return getCotizacionItemQuery.execute(input);
}
