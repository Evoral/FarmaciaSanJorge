/**
 * `calcularCotizacion` (M10, FASE 7 point 7.4, DP-09 RESUELTA). Pure
 * function, NO I/O, NO Prisma -- same discipline as
 * modules/elaboracion/domain/calcular-ficha-tecnica.ts and
 * modules/stock/domain/reparto.ts.
 *
 * ============================================================================
 * Cost basis (kept in exactly this one function so it can change without
 * hunting call sites):
 * ============================================================================
 * ONE source (openspec/specs/costos-proveedor/spec.md R25-R27, 2026-10-28):
 * the línea's droga's usable costo de proveedor (the caller looked it up and
 * passes it as `costoProveedor`). The línea costs the WHOLE required quantity
 * (in the droga's unidad base) x that costo, whether or not there is stock.
 * A droga WITHOUT a costo de proveedor has NO price: the línea is not costed
 * and its droga is listed in `drogasSinPrecio`; the item then has no price at
 * all (callers refuse it -- never the precio mínimo over a partial cost).
 * Exception (R38, openspec/changes/lotes-elaborados): a droga without one
 * but with a fórmula whose components all have one is priced from it
 * (`costoFormula`, fuente FORMULA); otherwise its components without one are
 * named instead of the droga.
 * Partidas never price a línea any more.
 *
 * Partidas are still evaluated, but ONLY for stock: the `faltante` ("not
 * enough stock to prepare it", informational, R28) and, in the cumulative
 * presupuesto, the stock simulation. The split REUSES
 * `modules/stock/domain/reparto.ts#proponerReparto` (open partida first, then
 * earliest expiry, expired excluded); when the eligible balance is short it
 * asks for exactly that balance (`proponerReparto` refuses partial requests),
 * and the gap is the `faltante`. Nothing is reserved, locked, or written
 * (INV-R02) -- this function does not even know a database exists.
 *
 * Manual-enrase and different-magnitud líneas are never costed (R29): they
 * contribute 0 and set `esParcial`; a quantity is NEVER invented for them.
 * The tramo margin and precio mínimo apply to the costo de insumos WITH IVA
 * (R31, R7a): each línea gets its costo's own alícuota (`costoUnitarioConIva`).
 * `subtotal` / `costoInsumos` stay net, `subtotalConIva` /
 * `costoInsumosConIva` carry the IVA; both are stored.
 *
 * Units: a línea's `cantidadAPesar` is in the línea's unit (its magnitud's
 * base, e.g. g); partidas and the costo unitario are in the droga's unidad
 * base (e.g. mg). The required quantity is converted before costing and
 * splitting; `cantidadRequerida` and `faltante` are reported back in the
 * línea's unit (`unidadSimbolo`).
 */
import { Decimal, dec } from "@/shared/decimal";
import { convertirCantidad, mismaMagnitud, type UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import { estaVencida, proponerReparto } from "@/modules/stock/domain/reparto";
import type { PartidaDisponible } from "@/modules/stock/domain/reparto";
import { calcularPrecioFinal } from "./regla-precio";
import type { ReglasPrecio } from "./regla-precio";

/** A partida as the repository reads it. `costoUnitario` no longer prices anything (R27): only the stock matters here. */
export interface PartidaCosteo extends PartidaDisponible {
  costoUnitario: Decimal | string;
}

export interface LineaCosteoInput {
  drogaId: string;
  drogaNombre: string;
  unidadSimbolo: string;
  /** In `unidad` (the línea's unit). `null` when `esEnraseManual` (openspec/specs/ficha-tecnica/spec.md). */
  cantidadAPesar: Decimal | string | null;
  /** The línea's unit (its magnitud's base unit, `unidadSimbolo`). */
  unidad: UnidadDeConversion;
  /** The droga's unidad base: the unit of its partidas' `cantidadDisponible` and `costoUnitario` (per unit). */
  unidadStock: UnidadDeConversion;
  esEnraseManual: boolean;
  orden: number;
  /**
   * The costo de proveedor chosen for this línea's droga (R26), or `null`/absent when it has none (-> no price, R27).
   * Chosen by the caller (application layer); this module only applies it.
   */
  costoProveedor?: CostoProveedorCosteo | null;
  /** R38: without `costoProveedor`, the cost from the droga's fórmula (every component with a costo de proveedor). */
  costoFormula?: CostoFormulaCosteo | null;
  /** R27: the droga has a fórmula but these components have no costo de proveedor -- named instead of the droga. */
  componentesSinCosto?: readonly string[];
}

/**
 * R38: the cost a `FORMULA` línea is priced with -- what its fórmula's components cost from their costos de proveedor,
 * per the droga's unidad base -- and what the snapshot keeps (R32). Chosen by the caller, like `costoProveedor`.
 */
export interface CostoFormulaCosteo {
  /** The fórmula's quantity of the product (the droga's unidad base) the components are for. */
  cantidadReferencia: string;
  costoUnitario: string;
  costoUnitarioConIva: string;
  componentes: { drogaNombre: string; cantidad: string; unidadSimbolo: string; proveedorNombre: string; costoUnitarioConIva: string }[];
}

/**
 * The costo de proveedor a `PROVEEDOR` línea is priced with: what the cotización needs to compute and what the
 * snapshot keeps (R32). `costoUnitario` is per the droga's unidad base (same convention as a partida's); the
 * `precioInformado` / `unidadPrecioSimbolo` are the price as written on the supplier's list, for display.
 */
export interface CostoProveedorCosteo {
  costoProveedorId: string;
  proveedorId: string;
  proveedorNombre: string;
  precioInformado: string;
  unidadPrecioSimbolo: string;
  costoUnitario: string;
  /**
   * R7a: the costo's alícuota and both prices with it; the línea is priced with `costoUnitarioConIva`. ABSENT in every
   * snapshot calculated before migration 0107 (those were priced without IVA).
   */
  alicuotaIva?: string;
  precioInformadoConIva?: string;
  costoUnitarioConIva?: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
}

/**
 * Where a línea's cost came from: its costo de proveedor (R25) or, without one, its fórmula's components' (R38).
 * `PARTIDAS` only in snapshots calculated before 2026-10-28 (R27).
 */
export type FuenteCosto = "PROVEEDOR" | "FORMULA" | "PARTIDAS";

export interface PartidaUsadaDetalle {
  partidaId: string;
  /** In the droga's unidad base (same unit as `costoUnitario`). */
  cantidad: string;
  costoUnitario: string;
  subtotal: string;
}

export interface LineaCotizacionDetalle {
  orden: number;
  drogaId: string;
  drogaNombre: string;
  unidadSimbolo: string;
  esEnraseManual: boolean;
  /** In the línea's unit (`unidadSimbolo`). */
  cantidadRequerida: string | null;
  /** Always empty for a `PROVEEDOR` línea (its cost does not come from partidas). */
  partidas: PartidaUsadaDetalle[];
  /** Net of IVA. */
  subtotal: string;
  /** R7a: the alícuota applied (percent) and the subtotal with it. ABSENT in every snapshot calculated before migration 0107. */
  alicuotaIva?: string;
  subtotalConIva?: string;
  /**
   * In the línea's unit. Present (and > 0) when the eligible stock does not cover the línea: informational ("not
   * enough stock to prepare it", R28). In a snapshot calculated before 2026-10-28, on a `PARTIDAS` línea it meant
   * "could not be fully costed" (`esIncompleta`).
   */
  faltante: string | null;
  /**
   * Always written by calculations from this feature on. ABSENT in every snapshot calculated before it: readers treat
   * a missing `fuente` as `PARTIDAS` (R32, see `leerDetalleCotizacion`).
   */
  fuente?: FuenteCosto;
  /** Only on a `PROVEEDOR` línea: the costo de proveedor it was priced with (R32). */
  costoProveedor?: CostoProveedorCosteo;
  /** Only on a `FORMULA` línea: the fórmula's cost it was priced with (R38). */
  costoFormula?: CostoFormulaCosteo;
}

export interface CotizacionDetalle {
  lineas: LineaCotizacionDetalle[];
}

/** A línea of a stored detalle as the readers (UI) get it: `fuente` always present. */
export interface LineaCotizacionLeida extends Omit<LineaCotizacionDetalle, "fuente" | "costoProveedor" | "costoFormula"> {
  fuente: FuenteCosto;
  /** `false`: a snapshot calculated before costos de proveedor existed (no `fuente` stored); `fuente` is then `PARTIDAS` by rule. */
  fuenteRegistrada: boolean;
  costoProveedor: CostoProveedorCosteo | null;
  costoFormula: CostoFormulaCosteo | null;
}

export interface CotizacionDetalleLeido {
  lineas: LineaCotizacionLeida[];
}

/**
 * R32: a stored detalle read for display. A línea without `fuente` (every cotización calculated before costos de
 * proveedor) is `PARTIDAS`, flagged `fuenteRegistrada: false` so it can render exactly as it always did.
 */
export function leerDetalleCotizacion(detalle: CotizacionDetalle): CotizacionDetalleLeido {
  return {
    lineas: detalle.lineas.map((l) => ({
      ...l,
      fuente: l.fuente ?? "PARTIDAS",
      fuenteRegistrada: l.fuente !== undefined,
      costoProveedor: l.fuente === "PROVEEDOR" ? (l.costoProveedor ?? null) : null,
      costoFormula: l.fuente === "FORMULA" ? (l.costoFormula ?? null) : null,
    })),
  };
}

export interface CotizacionCalculada {
  /** Net of IVA. */
  costoInsumos: Decimal;
  /** R7a: with each línea's IVA -- what the price is calculated on (tramo + precio mínimo). */
  costoInsumosConIva: Decimal;
  /** The markup of the tramo `costoInsumosConIva` fell into (regla-precio.ts#calcularPrecioFinal). */
  margenAplicado: Decimal;
  /** 0-based index of that tramo in the regla's `tramos`. */
  tramoAplicado: number;
  /** The tramo price was below the regla's `precioMinimo`, so the floor was used. */
  precioMinimoAplicado: boolean;
  precioFinal: Decimal;
  esParcial: boolean;
  /** Always `false` since 2026-10-28 (no línea is costed from partidas, R27); kept for stored snapshots. */
  esIncompleta: boolean;
  /**
   * Drogas of non-manual líneas without a costo de proveedor (R27), in línea order -- for a droga with a fórmula, its
   * components without one (`«componente» (componente de «droga»)`). Non-empty = the item has NO
   * price: callers must refuse it and never show or store `precioFinal`, which only covers the other líneas.
   */
  drogasSinPrecio: string[];
  detalle: CotizacionDetalle;
}

/** What is shown instead of a price when some droga has no costo de proveedor (R27). */
export function mensajeSinCostoProveedor(drogasSinPrecio: readonly string[]): string {
  const lista = drogasSinPrecio.join(", ");
  return drogasSinPrecio.length === 1
    ? `No se puede dar el precio: ${lista} no tiene precio cargado en costos de proveedor.`
    : `No se puede dar el precio: ${lista} no tienen precio cargado en costos de proveedor.`;
}

/**
 * Total balance across every partida `proponerReparto` would even consider
 * eligible (not expired as of `jornadaActual`, `cantidadDisponible > 0`) --
 * a literal restatement of `proponerReparto`'s own eligibility filter, kept
 * here ONLY so this module can decide how much to actually request from it
 * (see module doc comment). The split/ordering decision itself is never
 * duplicated -- it stays inside `proponerReparto`.
 */
function totalDisponibleElegible(partidas: readonly PartidaDisponible[], jornadaActual: string): Decimal {
  return partidas
    .filter((p) => !estaVencida(p.fechaVencimiento, jornadaActual) && dec(p.cantidadDisponible).greaterThan(0))
    .reduce((total, p) => total.plus(dec(p.cantidadDisponible)), new Decimal(0));
}

/** What a línea takes from a partida when the reparto is simulated (the droga's unidad base). */
interface ConsumoSimulado {
  drogaId: string;
  partidaId: string;
  cantidad: string;
}

/**
 * Costs ONE non-manual linea from its costo de proveedor (R25) or, without one, from its fórmula (R38); flags it
 * `sinPrecio` when it has neither (R27).
 * The partidas are ALWAYS evaluated, only for stock: the `faltante` and the simulated `consumo`.
 */
function costearLinea(
  linea: LineaCosteoInput,
  partidas: readonly PartidaDisponible[],
  jornadaActual: string,
): { detalle: LineaCotizacionDetalle; sinPrecio: boolean; consumo: { partidaId: string; cantidad: string }[] } {
  const requerida = dec(linea.cantidadAPesar as Decimal | string);
  // Partidas are in the droga's unidad base: split in it, report the faltante back in the línea's unit.
  const requeridaStock = convertirCantidad(requerida, linea.unidad, linea.unidadStock);

  const disponible = totalDisponibleElegible(partidas, jornadaActual);
  const aPedir = Decimal.min(requeridaStock, disponible);
  const faltante = convertirCantidad(requeridaStock.minus(aPedir), linea.unidadStock, linea.unidad);

  let consumo: { partidaId: string; cantidad: string }[] = [];
  if (aPedir.greaterThan(0)) {
    const resultado = proponerReparto(partidas, aPedir, jornadaActual);
    // aPedir is, by construction, <= the eligible total -- proponerReparto
    // always succeeds (ok: true) in that case; a `false` here would mean
    // this function's own eligibility math disagrees with
    // proponerReparto's, which is a bug worth surfacing loudly.
    if (!resultado.ok) {
      throw new Error(
        `calcularCotizacion: proponerReparto rejected a request (${aPedir.toString()}) that should have been fully coverable by the eligible total (${disponible.toString()}) -- this indicates totalDisponibleElegible and proponerReparto's internal eligibility filter have drifted apart.`,
      );
    }
    consumo = resultado.lineas.map((l) => ({ partidaId: l.partidaId, cantidad: l.cantidad.toString() }));
  }

  const base = {
    orden: linea.orden,
    drogaId: linea.drogaId,
    drogaNombre: linea.drogaNombre,
    unidadSimbolo: linea.unidadSimbolo,
    esEnraseManual: false,
    cantidadRequerida: requerida.toString(),
    partidas: [],
    faltante: faltante.greaterThan(0) ? faltante.toFixed() : null,
  };

  const costoProveedor = linea.costoProveedor ?? null;
  const costoFormula = linea.costoFormula ?? null;
  if (!costoProveedor && costoFormula) {
    // R38: the fórmula's cost, with its components' own IVA (no single alícuota: `alicuotaIva` stays absent).
    return {
      sinPrecio: false,
      consumo,
      detalle: {
        ...base,
        subtotal: requeridaStock.times(dec(costoFormula.costoUnitario)).toString(),
        subtotalConIva: requeridaStock.times(dec(costoFormula.costoUnitarioConIva)).toString(),
        fuente: "FORMULA",
        costoFormula: { ...costoFormula, componentes: costoFormula.componentes.map((c) => ({ ...c })) },
      },
    };
  }
  if (!costoProveedor) {
    // R27: no costo de proveedor, no price. Never stored: the callers refuse the whole item.
    return { sinPrecio: true, consumo, detalle: { ...base, subtotal: "0" } };
  }

  // R25: the WHOLE quantity (stock or not) at the proveedor's costo per unidad base. R28: the faltante is only informational.
  // R7a: priced with the costo's own IVA, as stored (`costoUnitarioConIva`).
  const alicuotaIva = costoProveedor.alicuotaIva ?? "0";
  return {
    sinPrecio: false,
    consumo,
    detalle: {
      ...base,
      subtotal: requeridaStock.times(dec(costoProveedor.costoUnitario)).toString(),
      alicuotaIva: dec(alicuotaIva).toString(),
      subtotalConIva: requeridaStock.times(dec(costoProveedor.costoUnitarioConIva ?? costoProveedor.costoUnitario)).toString(),
      fuente: "PROVEEDOR",
      costoProveedor: { ...costoProveedor },
    },
  };
}

/** `calcularCotizacion` plus what each línea would take from the partidas (including `PROVEEDOR` líneas, whose detalle lists none): the cumulative presupuesto needs it. */
function costearItem(
  lineas: readonly LineaCosteoInput[],
  partidasPorDroga: (drogaId: string) => readonly PartidaDisponible[],
  jornadaActual: string,
  reglas: ReglasPrecio,
): { cotizacion: CotizacionCalculada; consumos: ConsumoSimulado[] } {
  let costoInsumos = new Decimal(0);
  let costoInsumosConIva = new Decimal(0);
  let esParcial = false;
  const drogasSinPrecio: string[] = [];
  const detalleLineas: LineaCotizacionDetalle[] = [];
  const consumos: ConsumoSimulado[] = [];

  for (const linea of [...lineas].sort((a, b) => a.orden - b.orden)) {
    if (linea.esEnraseManual) {
      esParcial = true;
      detalleLineas.push({
        orden: linea.orden,
        drogaId: linea.drogaId,
        drogaNombre: linea.drogaNombre,
        unidadSimbolo: linea.unidadSimbolo,
        esEnraseManual: true,
        cantidadRequerida: null,
        partidas: [],
        subtotal: "0",
        faltante: null,
        fuente: "PARTIDAS",
      });
      continue;
    }

    if (!mismaMagnitud(linea.unidad, linea.unidadStock)) {
      // Not convertible into the droga's unidad base (no density conversion): not costed, like a manual línea.
      esParcial = true;
      detalleLineas.push({
        orden: linea.orden,
        drogaId: linea.drogaId,
        drogaNombre: linea.drogaNombre,
        unidadSimbolo: linea.unidadSimbolo,
        esEnraseManual: false,
        cantidadRequerida: linea.cantidadAPesar === null ? null : dec(linea.cantidadAPesar).toString(),
        partidas: [],
        subtotal: "0",
        faltante: null,
        fuente: "PARTIDAS",
      });
      continue;
    }

    const { detalle, sinPrecio, consumo } = costearLinea(linea, partidasPorDroga(linea.drogaId), jornadaActual);
    costoInsumos = costoInsumos.plus(dec(detalle.subtotal));
    costoInsumosConIva = costoInsumosConIva.plus(dec(detalle.subtotalConIva ?? detalle.subtotal));
    if (sinPrecio) {
      const nombres = linea.componentesSinCosto?.length ? linea.componentesSinCosto.map((c) => `${c} (componente de ${linea.drogaNombre})`) : [linea.drogaNombre];
      for (const nombre of nombres) if (!drogasSinPrecio.includes(nombre)) drogasSinPrecio.push(nombre);
    }
    detalleLineas.push(detalle);
    for (const usada of consumo) consumos.push({ drogaId: linea.drogaId, partidaId: usada.partidaId, cantidad: usada.cantidad });
  }

  // R31 + R7a: the price is calculated on the cost WITH IVA.
  const precio = calcularPrecioFinal(costoInsumosConIva, reglas);

  return {
    consumos,
    cotizacion: {
      costoInsumos,
      costoInsumosConIva,
      margenAplicado: precio.margenAplicado,
      tramoAplicado: precio.tramoAplicado,
      precioMinimoAplicado: precio.precioMinimoAplicado,
      precioFinal: precio.precioFinal,
      esParcial,
      esIncompleta: false,
      drogasSinPrecio,
      detalle: { lineas: detalleLineas },
    },
  };
}

/**
 * @param lineas every non-descartada linea_pesaje of the item's LATEST ficha tecnica, in `orden`; each may carry the `costoProveedor` chosen for its droga (R25).
 * @param partidasPorDroga eligible-or-not partidas for a given drogaId, for the stock faltante only (this function itself applies eligibility filtering -- callers may pass every partida of that droga, expired or not, with or without balance).
 * @param jornadaActual `YYYY-MM-DD`, from `fsj.jornada_actual(tenantId)` -- never `new Date()` (INV-PL-002).
 * @param reglas the OPEN regla_precio's precioMinimo + tramos at calculation time -- priced on THIS item's cost alone (each item / cotización independently).
 */
export function calcularCotizacion(
  lineas: readonly LineaCosteoInput[],
  partidasPorDroga: (drogaId: string) => readonly PartidaDisponible[],
  jornadaActual: string,
  reglas: ReglasPrecio,
): CotizacionCalculada {
  return costearItem(lineas, partidasPorDroga, jornadaActual, reglas).cotizacion;
}

// ============================================================================
// Several items of ONE receta against the SAME stock (openspec/specs/presupuesto-receta/spec.md)
// ============================================================================

/**
 * `fechaApertura` given to a partida the simulation starts consuming: it
 * would be opened by that preparación, so `proponerReparto` must treat it
 * as ABIERTA for the next item -- and as the most recently opened one.
 */
const APERTURA_SIMULADA = "9999-12-31T23:59:59.999Z";

/**
 * Costs the items of one receta in order, each against what the previous
 * ones left: the first item takes from the eligible balances exactly as
 * `calcularCotizacion` would, its consumption (partida by partida, as
 * `proponerReparto` split it) is subtracted, and the next item sees only
 * the remainder -- so the faltantes reflect the
 * receta as a whole. Each item is still PRICED on its own cost (tramo and
 * floor per item, never on the receta's total). The ordering/eligibility rules are NOT restated
 * here: every split still comes from `costearLinea` ->
 * `proponerReparto`. Pure; the caller's partidas are never mutated.
 *
 * Per línea the rule is the same as `calcularCotizacion`: the price comes
 * from the costo de proveedor whatever the simulation says, but every línea
 * (priced or not) STILL consumes stock in the simulation, so the faltantes
 * of later items stay right.
 */
export function calcularCotizacionesAcumuladas(
  items: readonly (readonly LineaCosteoInput[])[],
  partidasPorDroga: (drogaId: string) => readonly PartidaDisponible[],
  jornadaActual: string,
  reglas: ReglasPrecio,
): CotizacionCalculada[] {
  const saldos = new Map<string, PartidaDisponible[]>();
  const partidasDe = (drogaId: string): PartidaDisponible[] => {
    let partidas = saldos.get(drogaId);
    if (!partidas) {
      partidas = partidasPorDroga(drogaId).map((p) => ({ ...p }));
      saldos.set(drogaId, partidas);
    }
    return partidas;
  };

  return items.map((lineas) => {
    const { cotizacion, consumos } = costearItem(lineas, partidasDe, jornadaActual, reglas);
    for (const consumo of consumos) {
      const partida = partidasDe(consumo.drogaId).find((p) => p.id === consumo.partidaId);
      if (!partida) continue;
      partida.cantidadDisponible = dec(partida.cantidadDisponible).minus(dec(consumo.cantidad)).toString();
      if (partida.fechaApertura === null) partida.fechaApertura = APERTURA_SIMULADA;
    }
    return cotizacion;
  });
}
