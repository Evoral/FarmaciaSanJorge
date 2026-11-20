/**
 * `getResumenPagoReceta`: economic summary for the "Pago" card in `/recetas/[id]`.
 *
 * - With `cotizaciones.costo.ver`: total cost WITH IVA (what the regla de precio prices on) across the receta's items; any item without a saved
 *   cotización is costed on the fly with `costearItemsAcumulado`. If a droga lacks a cost, returns a notice with no figure.
 * - With `cotizaciones.calcular` or `cotizaciones.ver`: total precioFinal across each item's latest saved cotización
 *   (`max(calculadaEn)`), listing unquoted items as "sin cotizar".
 * - Security: omits `costo` when the session lacks `cotizaciones.costo.ver`, and omits `precio` when it lacks
 *   both `cotizaciones.calcular` and `cotizaciones.ver`.
 */
import { z } from "zod";
import { Decimal, dec } from "@/shared/decimal";
import { can } from "@/shared/auth/authorize";
import { requireSession } from "@/shared/auth/session";
import { defineQuery, type QueryHandlerArgs } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { calcularLineasFicha, resolverFormulaBorrador } from "@/modules/elaboracion/application/calcular-lineas-ficha";
import { costearItemsAcumulado, type LineaACostear } from "@/modules/precios/application/cotizar-lineas";
import { mensajeSinCostoProveedor } from "@/modules/precios/domain/calcular-cotizacion";
import { getItemsParaResumenPago, type ItemParaResumenPago } from "../infrastructure/receta-repository";
import { mensajeNoFatal } from "./presupuestar-receta";

export interface ResumenPagoReceta {
  /** Omitted when the session lacks `cotizaciones.costo.ver`. */
  costo?: {
    /** `null` when some item could not be costed (e.g. missing droga cost): show `avisos` without a figure. */
    total: string | null;
    avisos: string[];
  };
  /** Omitted when the session lacks both `cotizaciones.calcular` and `cotizaciones.ver`. */
  precio?: {
    /** `null` when no item has a saved cotización yet. */
    total: string | null;
    itemsSinCotizar: number[];
  };
}

const getResumenPagoInput = z.object({ recetaId: uuid });
type Parsed = z.output<typeof getResumenPagoInput>;

async function lineasParaCostearItem(tx: QueryHandlerArgs<Parsed>["tx"], tenantId: string, item: ItemParaResumenPago): Promise<LineaACostear[]> {
  if (item.ultimaFichaLineas) return item.ultimaFichaLineas;
  const formula = await resolverFormulaBorrador(tx, tenantId, {
    formaFarmaceutica: item.formaFarmaceutica,
    cantidadUnidades: item.cantidadUnidades,
    fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
    cantidadTotal: item.cantidadTotal,
    unidadTotalId: item.unidadTotalId,
    componentes: item.componentes,
  });
  const lineas = await calcularLineasFicha(tx, tenantId, formula.item, formula.componentes);
  return lineas.map((l) => ({
    drogaId: l.drogaId,
    drogaNombre: l.drogaNombre,
    unidadSimbolo: l.unidadSimbolo,
    unidad: { factorABase: String(l.unidadMedida.factorABase), tipoMagnitud: l.unidadMedida.tipoMagnitud },
    cantidadAPesar: l.cantidadAPesar,
    esEnraseManual: l.esEnraseManual,
    orden: l.orden,
  }));
}

async function handler({ tx, session, input }: QueryHandlerArgs<Parsed>): Promise<ResumenPagoReceta | null> {
  const items = await getItemsParaResumenPago(tx, session.tenantId, input.recetaId);
  if (!items) return null;

  const incluirCosto = can(session, "cotizaciones.costo.ver");
  const incluirPrecio = can(session, "cotizaciones.calcular") || can(session, "cotizaciones.ver");

  let precioTotal = new Decimal(0);
  let itemsCotizados = 0;
  const itemsSinCotizar: number[] = [];

  let costoTotal = new Decimal(0);
  let costoCompleto = true;
  const avisosCosto: string[] = [];
  const lineasSinCotizacion: LineaACostear[][] = [];

  for (const [idx, item] of items.entries()) {
    const numero = idx + 1;
    if (item.ultimaCotizacion) {
      if (incluirPrecio) {
        precioTotal = precioTotal.plus(dec(item.ultimaCotizacion.precioFinal));
        itemsCotizados++;
      }
      if (incluirCosto) {
        costoTotal = costoTotal.plus(dec(item.ultimaCotizacion.costoConIva));
      }
      continue;
    }

    if (incluirPrecio) itemsSinCotizar.push(numero);
    if (incluirCosto) {
      try {
        lineasSinCotizacion.push(await lineasParaCostearItem(tx, session.tenantId, item));
      } catch (error) {
        const mensaje = mensajeNoFatal(error);
        if (mensaje === null) throw error;
        costoCompleto = false;
        avisosCosto.push(`Ítem ${numero}: ${mensaje}`);
      }
    }
  }

  if (incluirCosto && lineasSinCotizacion.length > 0) {
    const costosCalculados = await costearItemsAcumulado(tx, session.tenantId, lineasSinCotizacion);
    for (const c of costosCalculados) {
      if (c.drogasSinPrecio.length > 0) {
        costoCompleto = false;
        avisosCosto.push(mensajeSinCostoProveedor(c.drogasSinPrecio));
      } else {
        costoTotal = costoTotal.plus(c.costoInsumosConIva);
      }
    }
  }

  return {
    ...(incluirCosto
      ? {
          costo: {
            total: costoCompleto ? costoTotal.toString() : null,
            avisos: [...new Set(avisosCosto)],
          },
        }
      : {}),
    ...(incluirPrecio
      ? {
          precio: {
            total: itemsCotizados > 0 ? precioTotal.toString() : null,
            itemsSinCotizar,
          },
        }
      : {}),
  };
}

export const getResumenPagoRecetaCostoQuery = defineQuery({
  name: "recetas.resumenPago.costo",
  permiso: "cotizaciones.costo.ver",
  input: getResumenPagoInput,
  handler,
});

export const getResumenPagoRecetaCalcularQuery = defineQuery({
  name: "recetas.resumenPago.calcular",
  permiso: "cotizaciones.calcular",
  input: getResumenPagoInput,
  handler,
});

export const getResumenPagoRecetaVerQuery = defineQuery({
  name: "recetas.resumenPago.ver",
  permiso: "cotizaciones.ver",
  input: getResumenPagoInput,
  handler,
});

export async function getResumenPagoReceta(recetaId: string): Promise<ResumenPagoReceta | null> {
  const session = await requireSession();
  const query = can(session, "cotizaciones.costo.ver")
    ? getResumenPagoRecetaCostoQuery
    : can(session, "cotizaciones.calcular")
      ? getResumenPagoRecetaCalcularQuery
      : can(session, "cotizaciones.ver")
        ? getResumenPagoRecetaVerQuery
        : getResumenPagoRecetaCostoQuery;
  return query.execute({ recetaId });
}
