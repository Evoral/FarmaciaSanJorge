/**
 * Presupuesto of a receta being loaded (docs/specs/presupuesto-receta.md):
 * the price shown at the counter BEFORE anything is saved, so the client
 * can decide whether to go on. Pure: the shapes returned by
 * `recetas.presupuestar`, how one item's in-memory cotización becomes a
 * presupuesto line, the total, and the form's "is the draft complete
 * enough to price" check. No I/O.
 */
import { Decimal, dec } from "@/shared/decimal";
import type { CotizacionCalculada } from "@/modules/precios/domain/calcular-cotizacion";

/**
 * The receta as a whole needs more of a droga than the eligible stock has
 * (items are costed cumulatively, in order: see `recetas.presupuestar`).
 * Never blocks -- it must be SEEN.
 */
export interface FaltanteStockReceta {
  drogaNombre: string;
  /** Decimal strings, in the droga's base unit. */
  requerida: string;
  disponible: string;
  unidadSimbolo: string;
  mensaje: string;
}

export const MENSAJE_SIN_REGLA_PRECIO = "No hay regla de precios configurada. Pedile a un administrador que configure las reglas de precio para ver el presupuesto.";

export interface FaltanteStock {
  drogaNombre: string;
  /** Decimal string, in the line's base unit. */
  cantidad: string;
  unidadSimbolo: string;
}

export type PresupuestoItem =
  | {
      /** 1-based, same numbering as the form ("Ítem 1"). */
      indice: number;
      ok: true;
      precioFinal: string;
      costoInsumos: string;
      /** Some excipiente is completed at preparation time (manual enrase): priced without it. */
      esParcial: boolean;
      enraseManual: string[];
      /** Not enough stock for some droga: priced with what exists. */
      esIncompleta: boolean;
      faltantes: FaltanteStock[];
    }
  | { indice: number; ok: false; mensaje: string };

export type Presupuesto =
  | {
      ok: true;
      /** Sum of the items that could be priced. */
      total: string;
      /** `false` when some item could not be priced (its message says why): the total leaves it out. */
      totalCompleto: boolean;
      items: PresupuestoItem[];
      /** Drogas whose combined demand across the receta exceeds the eligible stock. */
      faltantesReceta: FaltanteStockReceta[];
    }
  | { ok: false; mensaje: string };

/** One item's in-memory cotización -> its presupuesto line. */
export function presupuestoItemDesdeCotizacion(indice: number, cotizacion: CotizacionCalculada): PresupuestoItem {
  const lineas = cotizacion.detalle.lineas;
  return {
    indice,
    ok: true,
    precioFinal: cotizacion.precioFinal.toString(),
    costoInsumos: cotizacion.costoInsumos.toString(),
    esParcial: cotizacion.esParcial,
    enraseManual: lineas.filter((l) => l.esEnraseManual).map((l) => l.drogaNombre),
    esIncompleta: cotizacion.esIncompleta,
    faltantes: lineas
      .filter((l) => l.faltante !== null)
      .map((l) => ({ drogaNombre: l.drogaNombre, cantidad: l.faltante!, unidadSimbolo: l.unidadSimbolo })),
  };
}

export function armarPresupuesto(items: PresupuestoItem[], faltantesReceta: FaltanteStockReceta[] = []): Presupuesto {
  const total = items.reduce((suma, item) => (item.ok ? suma.plus(dec(item.precioFinal)) : suma), new Decimal(0));
  return { ok: true, total: total.toString(), totalCompleto: items.every((i) => i.ok), items, faltantesReceta };
}

/**
 * es-AR with up to 3 decimals and no trailing zeros, for quantities in a
 * sentence ("3.000,5", "3", "0,149"). Fixed zeros made "3,000 g" read as
 * three thousand.
 */
function cantidadEsAr(valor: Decimal): string {
  const [entero, fraccion = ""] = valor.toDecimalPlaces(3).toFixed().split(".");
  const miles = entero!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraccion ? `${miles},${fraccion}` : miles;
}

/**
 * Per droga, over the cumulatively costed items of one receta: total
 * demand vs. what could be covered. With cumulative costing, the sum of
 * the items' faltantes IS the receta's shortage (demand - eligible stock),
 * so the eligible stock is demand - shortage.
 */
export function faltantesDeReceta(cotizaciones: readonly CotizacionCalculada[]): FaltanteStockReceta[] {
  const porDroga = new Map<string, { drogaNombre: string; unidadSimbolo: string; requerida: Decimal; faltante: Decimal }>();
  for (const cotizacion of cotizaciones) {
    for (const linea of cotizacion.detalle.lineas) {
      if (linea.esEnraseManual || linea.cantidadRequerida === null) continue;
      const acumulado = porDroga.get(linea.drogaId) ?? { drogaNombre: linea.drogaNombre, unidadSimbolo: linea.unidadSimbolo, requerida: new Decimal(0), faltante: new Decimal(0) };
      acumulado.requerida = acumulado.requerida.plus(dec(linea.cantidadRequerida));
      if (linea.faltante !== null) acumulado.faltante = acumulado.faltante.plus(dec(linea.faltante));
      porDroga.set(linea.drogaId, acumulado);
    }
  }
  return [...porDroga.values()]
    .filter((d) => d.faltante.greaterThan(0))
    .map((d) => {
      const disponible = d.requerida.minus(d.faltante);
      return {
        drogaNombre: d.drogaNombre,
        requerida: d.requerida.toString(),
        disponible: disponible.toString(),
        unidadSimbolo: d.unidadSimbolo,
        mensaje: `Falta stock de ${d.drogaNombre} para toda la receta: se necesitan ${cantidadEsAr(d.requerida)} ${d.unidadSimbolo} y hay ${cantidadEsAr(disponible)} ${d.unidadSimbolo} disponibles.`,
      };
    });
}

// ============================================================================
// "Complete enough to price" -- the form only asks for a presupuesto then.
// ============================================================================

export interface ComponentePresupuestable {
  drogaId: string;
  cantidad: string | null;
  unidadMedidaId: string;
  modoExpresion: "TOTAL" | "POR_DOSIS" | "CS" | "CSP";
}

export interface ItemPresupuestable {
  cantidadUnidades: number;
  fraccionDosisPorUnidad: string;
  cantidadTotal: string | null;
  unidadTotalId: string | null;
  componentes: ComponentePresupuestable[];
}

const DECIMAL_POSITIVO = /^\d+(\.\d+)?$/;

function esDecimalPositivo(valor: string | null): boolean {
  return valor !== null && DECIMAL_POSITIVO.test(valor) && Number(valor) > 0;
}

/**
 * Every item has a whole number of units, a valid fracción, a complete
 * (or absent) total, and every componente has its droga, its unidad and a
 * valid cantidad (> 0 for TOTAL/POR_DOSIS, none for CS/CSP). The V1-V9
 * rules proper are NOT re-checked here: the server reports them per item.
 */
export function itemsListosParaPresupuesto(items: readonly ItemPresupuestable[]): boolean {
  return (
    items.length > 0 &&
    items.every(
      (item) =>
        Number.isInteger(item.cantidadUnidades) &&
        item.cantidadUnidades > 0 &&
        esDecimalPositivo(item.fraccionDosisPorUnidad) &&
        (item.cantidadTotal === null) === (item.unidadTotalId === null) &&
        (item.cantidadTotal === null || esDecimalPositivo(item.cantidadTotal)) &&
        item.componentes.length > 0 &&
        item.componentes.every(
          (c) =>
            c.drogaId.length > 0 &&
            c.unidadMedidaId.length > 0 &&
            (c.modoExpresion === "TOTAL" || c.modoExpresion === "POR_DOSIS" ? esDecimalPositivo(c.cantidad) : c.cantidad === null),
        ),
    )
  );
}
