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
 * Two sources, chosen PER LÍNEA (openspec/specs/costos-proveedor/spec.md, R25-R30):
 *
 *   - `PROVEEDOR`: the línea's droga has a usable costo de proveedor (the
 *     caller looked it up and passes it as `costoProveedor`). The línea costs
 *     the WHOLE required quantity (in the droga's unidad base) x that
 *     `costoUnitario`, whether or not there is stock. Partidas are still
 *     evaluated, but ONLY to report the `faltante` ("not enough stock to
 *     prepare it": informational, it does NOT make the cotización
 *     `esIncompleta`) and, in the cumulative presupuesto, to keep the stock
 *     simulation right. The línea's `partidas` list in the detalle is empty.
 *   - `PARTIDAS`: no costo de proveedor -> exactly the algorithm described
 *     below (R27, the explicit fallback).
 *
 * Manual-enrase and different-magnitud líneas are never costed, whatever the
 * source (R29). The tramo margin and precio mínimo apply to the resulting
 * costo de insumos WITH IVA (R31, R7a): each línea also gets its IVA -- a
 * `PROVEEDOR` línea its costo's own alícuota (`costoUnitarioConIva`), a
 * `PARTIDAS` línea the tenant's (`alicuotaIvaPartidas`; partidas are net).
 * `subtotal` / `costoInsumos` stay net, `subtotalConIva` / `costoInsumosConIva`
 * carry the IVA; both are stored.
 *
 * PARTIDAS algorithm: for each NON-manual `linea_pesaje` of the item's LATEST ficha tecnica,
 * cost the quantities the reparto WOULD use if a preparacion confirmed
 * right now -- REUSING `modules/stock/domain/reparto.ts#proponerReparto`
 * (open partida first, then earliest expiry among the rest, expired
 * excluded), never a separate, hand-rolled ordering. Each portion is
 * costed at ITS partida's `costoUnitario`. Nothing is reserved, locked, or
 * written anywhere (INV-R02) -- this function does not even know a
 * database exists.
 *
 * Manual-enrase lines (esEnraseManual = true) have NO computable quantity
 * -- R4/R5/R6 of openspec/specs/ficha-tecnica/spec.md explicitly leave
 * `cantidadAPesar = null` for them. They contribute EXACTLY 0 to
 * `costoInsumos` and set `esParcial = true` on the result -- a quantity is
 * NEVER invented for them, per the task's own instruction.
 *
 * Insufficient stock does NOT fail the calculation (task instruction:
 * "cost what exists, and flag the cotizacion as incomplete with the
 * missing amount"). `proponerReparto` itself refuses to return a partial
 * split when the request cannot be fully covered (by design -- see that
 * module's own doc comment: "not a partial proposal"), so this module
 * NEVER hands it the full requested quantity when there isn't enough --
 * it first sums the ELIGIBLE balance (same eligibility rule
 * `proponerReparto` applies internally: not expired, cantidadDisponible >
 * 0) and, when that total is short, asks `proponerReparto` for exactly
 * that total instead. That call then succeeds (ok: true) and drains every
 * eligible partida in full -- which IS "cost what exists": the real
 * reparto ordering decided exactly how those existing units would be
 * split, this function only chose a smaller target quantity to stay
 * inside what `proponerReparto`'s own contract allows. The gap
 * (`cantidadRequerida - totalDisponible`) is recorded as the linea's
 * `faltante` and flips `esIncompleta` on the result -- see
 * `totalDisponibleElegible` below for the shared eligibility filter (a
 * literal copy of `proponerReparto`'s own two-line filter, NOT a
 * reimplementation of the ordering/splitting algorithm itself, which stays
 * exclusively inside `proponerReparto`).
 *
 * Units: a línea's `cantidadAPesar` is in the línea's unit (its magnitud's
 * base, e.g. g); partidas (`cantidadDisponible`, and `costoUnitario` per
 * unit) are in the droga's unidad base (e.g. mg). The required quantity is
 * converted into the droga's unidad base before the split, so the costed
 * partida amounts are in it; `cantidadRequerida` and `faltante` are reported
 * back in the línea's unit (`unidadSimbolo`). A línea whose unit can not be
 * converted (different magnitud) is not costed: it contributes 0 and sets
 * `esParcial`, like a manual-enrase línea.
 */
import { Decimal, dec } from "@/shared/decimal";
import { convertirCantidad, mismaMagnitud, type UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import { estaVencida, proponerReparto } from "@/modules/stock/domain/reparto";
import type { PartidaDisponible } from "@/modules/stock/domain/reparto";
import { aplicarIva } from "@/modules/costos-proveedor/domain/costo-proveedor";
import { calcularPrecioFinal } from "./regla-precio";
import type { ReglasPrecio } from "./regla-precio";

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
   * The costo de proveedor chosen for this línea's droga (R26), or `null`/absent when it has none (-> PARTIDAS).
   * Chosen by the caller (application layer); this module only applies it.
   */
  costoProveedor?: CostoProveedorCosteo | null;
  /** R7a: percent of IVA a `PARTIDAS` línea gets (the tenant's `alicuota_iva_porcentaje`; partidas are net). Absent = 0. */
  alicuotaIvaPartidas?: Decimal | string;
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

/** Where a línea's cost came from (R25, R27). */
export type FuenteCosto = "PROVEEDOR" | "PARTIDAS";

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
   * In the línea's unit. Present (and > 0) when the eligible stock does not cover the línea. On a `PARTIDAS` línea it
   * means "could not be fully costed" (and makes the cotización `esIncompleta`); on a `PROVEEDOR` línea it is
   * informational ("not enough stock to prepare it") and never makes it incomplete (R28).
   */
  faltante: string | null;
  /**
   * Always written by calculations from this feature on. ABSENT in every snapshot calculated before it: readers treat
   * a missing `fuente` as `PARTIDAS` (R32, see `leerDetalleCotizacion`).
   */
  fuente?: FuenteCosto;
  /** Only on a `PROVEEDOR` línea: the costo de proveedor it was priced with (R32). */
  costoProveedor?: CostoProveedorCosteo;
}

export interface CotizacionDetalle {
  lineas: LineaCotizacionDetalle[];
}

/** A línea of a stored detalle as the readers (UI) get it: `fuente` always present. */
export interface LineaCotizacionLeida extends Omit<LineaCotizacionDetalle, "fuente" | "costoProveedor"> {
  fuente: FuenteCosto;
  /** `false`: a snapshot calculated before costos de proveedor existed (no `fuente` stored); `fuente` is then `PARTIDAS` by rule. */
  fuenteRegistrada: boolean;
  costoProveedor: CostoProveedorCosteo | null;
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
  esIncompleta: boolean;
  detalle: CotizacionDetalle;
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
 * Costs ONE non-manual linea. Never throws -- always returns a costed (possibly partial) result.
 *
 * The partidas are ALWAYS evaluated (reparto + faltante). With a costo de proveedor the línea is priced from it
 * (R25) and the partidas only feed `faltante` and the stock simulation (`consumo`); without one the cost is the
 * partidas' blend, exactly as before this feature (R27).
 */
function costearLinea(
  linea: LineaCosteoInput,
  partidas: readonly PartidaCosteo[],
  jornadaActual: string,
): { detalle: LineaCotizacionDetalle; incompleta: boolean; consumo: PartidaUsadaDetalle[] } {
  const requerida = dec(linea.cantidadAPesar as Decimal | string);
  // Partidas are in the droga's unidad base: split in it, report the faltante back in the línea's unit.
  const requeridaStock = convertirCantidad(requerida, linea.unidad, linea.unidadStock);
  const costoPorPartida = new Map(partidas.map((p) => [p.id, dec(p.costoUnitario)]));

  const disponible = totalDisponibleElegible(partidas, jornadaActual);
  const aPedir = Decimal.min(requeridaStock, disponible);
  const faltante = convertirCantidad(requeridaStock.minus(aPedir), linea.unidadStock, linea.unidad);

  let partidasUsadas: PartidaUsadaDetalle[] = [];
  let subtotal = new Decimal(0);

  if (aPedir.greaterThan(0)) {
    const resultado = proponerReparto(partidas, aPedir, jornadaActual);
    // aPedir is, by construction, <= the eligible total -- proponerReparto
    // always succeeds (ok: true) in that case; a `false` here would mean
    // this function's own eligibility math disagrees with
    // proponerReparto's, which is a bug worth surfacing loudly rather than
    // silently treating the whole linea as unavailable.
    if (!resultado.ok) {
      throw new Error(
        `calcularCotizacion: proponerReparto rejected a request (${aPedir.toString()}) that should have been fully coverable by the eligible total (${disponible.toString()}) -- this indicates totalDisponibleElegible and proponerReparto's internal eligibility filter have drifted apart.`,
      );
    }
    partidasUsadas = resultado.lineas.map((l) => {
      const costoUnitario = costoPorPartida.get(l.partidaId) ?? new Decimal(0);
      const sub = l.cantidad.times(costoUnitario);
      subtotal = subtotal.plus(sub);
      return {
        partidaId: l.partidaId,
        cantidad: l.cantidad.toString(),
        costoUnitario: costoUnitario.toString(),
        subtotal: sub.toString(),
      };
    });
  }

  const costoProveedor = linea.costoProveedor ?? null;
  if (costoProveedor) {
    // R25: the WHOLE quantity (stock or not) at the proveedor's costo per unidad base. R28: the faltante is only informational.
    // R7a: priced with the costo's own IVA, as stored (`costoUnitarioConIva`).
    const alicuotaIva = costoProveedor.alicuotaIva ?? "0";
    return {
      incompleta: false,
      consumo: partidasUsadas,
      detalle: {
        orden: linea.orden,
        drogaId: linea.drogaId,
        drogaNombre: linea.drogaNombre,
        unidadSimbolo: linea.unidadSimbolo,
        esEnraseManual: false,
        cantidadRequerida: requerida.toString(),
        partidas: [],
        subtotal: requeridaStock.times(dec(costoProveedor.costoUnitario)).toString(),
        alicuotaIva: dec(alicuotaIva).toString(),
        subtotalConIva: requeridaStock.times(dec(costoProveedor.costoUnitarioConIva ?? costoProveedor.costoUnitario)).toString(),
        faltante: faltante.greaterThan(0) ? faltante.toFixed() : null,
        fuente: "PROVEEDOR",
        costoProveedor: { ...costoProveedor },
      },
    };
  }

  const alicuotaIvaPartidas = dec(linea.alicuotaIvaPartidas ?? 0);
  return {
    incompleta: faltante.greaterThan(0),
    consumo: partidasUsadas,
    detalle: {
      orden: linea.orden,
      drogaId: linea.drogaId,
      drogaNombre: linea.drogaNombre,
      unidadSimbolo: linea.unidadSimbolo,
      esEnraseManual: false,
      cantidadRequerida: requerida.toString(),
      partidas: partidasUsadas,
      subtotal: subtotal.toString(),
      alicuotaIva: alicuotaIvaPartidas.toString(),
      subtotalConIva: aplicarIva(subtotal, alicuotaIvaPartidas).toString(),
      faltante: faltante.greaterThan(0) ? faltante.toFixed() : null,
      fuente: "PARTIDAS",
    },
  };
}

/** `calcularCotizacion` plus what each línea would take from the partidas (including `PROVEEDOR` líneas, whose detalle lists none): the cumulative presupuesto needs it. */
function costearItem(
  lineas: readonly LineaCosteoInput[],
  partidasPorDroga: (drogaId: string) => readonly PartidaCosteo[],
  jornadaActual: string,
  reglas: ReglasPrecio,
): { cotizacion: CotizacionCalculada; consumos: ConsumoSimulado[] } {
  let costoInsumos = new Decimal(0);
  let costoInsumosConIva = new Decimal(0);
  let esParcial = false;
  let esIncompleta = false;
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

    const { detalle, incompleta, consumo } = costearLinea(linea, partidasPorDroga(linea.drogaId), jornadaActual);
    costoInsumos = costoInsumos.plus(dec(detalle.subtotal));
    costoInsumosConIva = costoInsumosConIva.plus(dec(detalle.subtotalConIva ?? detalle.subtotal));
    if (incompleta) esIncompleta = true;
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
      esIncompleta,
      detalle: { lineas: detalleLineas },
    },
  };
}

/**
 * @param lineas every non-descartada linea_pesaje of the item's LATEST ficha tecnica, in `orden`; each may carry the `costoProveedor` chosen for its droga (R25).
 * @param partidasPorDroga eligible-or-not partidas for a given drogaId (this function itself applies eligibility filtering -- callers may pass every partida of that droga, expired or not, with or without balance).
 * @param jornadaActual `YYYY-MM-DD`, from `fsj.jornada_actual(tenantId)` -- never `new Date()` (INV-PL-002).
 * @param reglas the OPEN regla_precio's precioMinimo + tramos at calculation time -- priced on THIS item's cost alone (each item / cotización independently).
 */
export function calcularCotizacion(
  lineas: readonly LineaCosteoInput[],
  partidasPorDroga: (drogaId: string) => readonly PartidaCosteo[],
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
 * the remainder -- so faltantes, `esIncompleta` and costs reflect the
 * receta as a whole. Each item is still PRICED on its own cost (tramo and
 * floor per item, never on the receta's total). The ordering/eligibility rules are NOT restated
 * here: every split still comes from `costearLinea` ->
 * `proponerReparto`. Pure; the caller's partidas are never mutated.
 *
 * Per línea the source rule is the same as `calcularCotizacion` (R30): a
 * `PROVEEDOR` línea costs from its costo de proveedor whatever the
 * simulation says, but it STILL consumes stock in the simulation (what it
 * would take from the partidas), so the faltantes of later items stay right.
 */
export function calcularCotizacionesAcumuladas(
  items: readonly (readonly LineaCosteoInput[])[],
  partidasPorDroga: (drogaId: string) => readonly PartidaCosteo[],
  jornadaActual: string,
  reglas: ReglasPrecio,
): CotizacionCalculada[] {
  const saldos = new Map<string, PartidaCosteo[]>();
  const partidasDe = (drogaId: string): PartidaCosteo[] => {
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
