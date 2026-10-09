/**
 * `calcularCotizacion` (M10, FASE 7 point 7.4, DP-09 RESUELTA). Pure
 * function, NO I/O, NO Prisma -- same discipline as
 * modules/elaboracion/domain/calcular-ficha-tecnica.ts and
 * modules/stock/domain/reparto.ts.
 *
 * ============================================================================
 * Cost basis (task's own words, this is an ASSUMPTION -- kept in exactly
 * this one function so it can change without hunting call sites):
 * ============================================================================
 * For each NON-manual `linea_pesaje` of the item's LATEST ficha tecnica,
 * cost the quantities the reparto WOULD use if a preparacion confirmed
 * right now -- REUSING `modules/stock/domain/reparto.ts#proponerReparto`
 * (open partida first, then earliest expiry among the rest, expired
 * excluded), never a separate, hand-rolled ordering. Each portion is
 * costed at ITS partida's `costoUnitario`. Nothing is reserved, locked, or
 * written anywhere (INV-R02) -- this function does not even know a
 * database exists.
 *
 * Manual-enrase lines (esEnraseManual = true) have NO computable quantity
 * -- R4/R5/R6 of docs/specs/ficha-tecnica.md explicitly leave
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
import { calcularPrecioFinal } from "./regla-precio";
import type { ReglasPrecio } from "./regla-precio";

export interface PartidaCosteo extends PartidaDisponible {
  costoUnitario: Decimal | string;
}

export interface LineaCosteoInput {
  drogaId: string;
  drogaNombre: string;
  unidadSimbolo: string;
  /** In `unidad` (the línea's unit). `null` when `esEnraseManual` (docs/specs/ficha-tecnica.md). */
  cantidadAPesar: Decimal | string | null;
  /** The línea's unit (its magnitud's base unit, `unidadSimbolo`). */
  unidad: UnidadDeConversion;
  /** The droga's unidad base: the unit of its partidas' `cantidadDisponible` and `costoUnitario` (per unit). */
  unidadStock: UnidadDeConversion;
  esEnraseManual: boolean;
  orden: number;
}

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
  partidas: PartidaUsadaDetalle[];
  subtotal: string;
  /** In the línea's unit. Present (and > 0) only when this linea could not be fully costed for lack of stock. */
  faltante: string | null;
}

export interface CotizacionDetalle {
  lineas: LineaCotizacionDetalle[];
}

export interface CotizacionCalculada {
  costoInsumos: Decimal;
  /** The markup of the tramo `costoInsumos` fell into (regla-precio.ts#calcularPrecioFinal). */
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

/** Costs ONE non-manual linea against its droga's eligible partidas. Never throws -- always returns a costed (possibly partial) result. */
function costearLinea(
  linea: LineaCosteoInput,
  partidas: readonly PartidaCosteo[],
  jornadaActual: string,
): { detalle: LineaCotizacionDetalle; incompleta: boolean } {
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

  return {
    incompleta: faltante.greaterThan(0),
    detalle: {
      orden: linea.orden,
      drogaId: linea.drogaId,
      drogaNombre: linea.drogaNombre,
      unidadSimbolo: linea.unidadSimbolo,
      esEnraseManual: false,
      cantidadRequerida: requerida.toString(),
      partidas: partidasUsadas,
      subtotal: subtotal.toString(),
      faltante: faltante.greaterThan(0) ? faltante.toFixed() : null,
    },
  };
}

/**
 * @param lineas every non-descartada linea_pesaje of the item's LATEST ficha tecnica, in `orden`.
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
  let costoInsumos = new Decimal(0);
  let esParcial = false;
  let esIncompleta = false;
  const detalleLineas: LineaCotizacionDetalle[] = [];

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
      });
      continue;
    }

    const { detalle, incompleta } = costearLinea(linea, partidasPorDroga(linea.drogaId), jornadaActual);
    costoInsumos = costoInsumos.plus(dec(detalle.subtotal));
    if (incompleta) esIncompleta = true;
    detalleLineas.push(detalle);
  }

  const precio = calcularPrecioFinal(costoInsumos, reglas);

  return {
    costoInsumos,
    margenAplicado: precio.margenAplicado,
    tramoAplicado: precio.tramoAplicado,
    precioMinimoAplicado: precio.precioMinimoAplicado,
    precioFinal: precio.precioFinal,
    esParcial,
    esIncompleta,
    detalle: { lineas: detalleLineas },
  };
}

// ============================================================================
// Several items of ONE receta against the SAME stock (docs/specs/presupuesto-receta.md)
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
 * here: every split still comes from `calcularCotizacion` ->
 * `proponerReparto`. Pure; the caller's partidas are never mutated.
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
    const cotizacion = calcularCotizacion(lineas, partidasDe, jornadaActual, reglas);
    for (const linea of cotizacion.detalle.lineas) {
      const partidas = partidasDe(linea.drogaId);
      for (const usada of linea.partidas) {
        const partida = partidas.find((p) => p.id === usada.partidaId);
        if (!partida) continue;
        partida.cantidadDisponible = dec(partida.cantidadDisponible).minus(dec(usada.cantidad)).toString();
        if (partida.fechaApertura === null) partida.fechaApertura = APERTURA_SIMULADA;
      }
    }
    return cotizacion;
  });
}
