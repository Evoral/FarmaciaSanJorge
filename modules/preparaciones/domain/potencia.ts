/**
 * Purity / activity correction per partida (migrations 0058 & 0133). Pure: no I/O,
 * no Prisma.
 *
 * A lot declares either:
 *   - `PORCENTAJE` (`partida.potencia_declarada`, percent, NULL = 100%):
 *       physical weight = active x 100 / potencia
 *       active          = physical x potencia / 100
 *   - `ACTIVIDAD` (`partida.actividad_declarada`, U.I. per gram of physical lot):
 *       physical weight = (active UI / uiPorGramo) grams -> droga's unidad base
 *       active          = physical (in grams) x uiPorGramo
 *
 * Stock (`movimiento_stock.cantidad`) is always decremented in PHYSICAL
 * units. Manual-enrase lines get no correction (the caller does not use
 * this file for them).
 *
 * Rounding: a physical weight derived from a potencia below 100 or from an
 * ACTIVIDAD factor is rounded UP to `DECIMALES_PESO_FISICO` decimals (never
 * under-dosing), capped at the partida's balance. A partida at 100% is never
 * rounded, so a split over partidas without declared purity is IDENTICAL to
 * `modules/stock/domain/reparto.ts#proponerReparto`'s.
 */
import { Decimal, dec } from "@/shared/decimal";
import { convertirCantidad, type UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import { ordenarParaConsumo, type PartidaDisponible } from "@/modules/stock/domain/reparto";

/** NULL potencia = 100% (no correction). */
export const POTENCIA_SIN_CORRECCION = "100";

/**
 * Decimals a purity/activity-corrected physical weight is rounded (up) to, in the droga's unidad base.
 * INV-S12 in the DB (migrations 0060/0088/0133, `v_tolerancia` = 10^-4) is sized for this value: change both together.
 */
export const DECIMALES_PESO_FISICO = 4;

const UNIDAD_GRAMO: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "MASA" };

export type FactorPotencia =
  | { readonly tipo: "PORCENTAJE"; readonly valor: Decimal | string }
  | { readonly tipo: "ACTIVIDAD"; readonly uiPorGramo: Decimal | string };

export type FactorPotenciaInput = FactorPotencia | Decimal | string | null | undefined;

function esFactorTaggeado(input: FactorPotenciaInput): input is FactorPotencia {
  return typeof input === "object" && input !== null && "tipo" in input;
}

function normalizarFactor(input: FactorPotenciaInput): FactorPotencia {
  if (esFactorTaggeado(input)) {
    if (input.tipo === "ACTIVIDAD") {
      if (!dec(input.uiPorGramo).greaterThan(0)) {
        throw new RangeError("potencia: uiPorGramo must be greater than zero.");
      }
      return input;
    }
    return input;
  }
  return { tipo: "PORCENTAJE", valor: potenciaEfectiva(input) };
}

/** Builds a `FactorPotencia` from a partida's declared `potenciaDeclarada` / `actividadDeclarada`. */
export function factorDePartida(partida: {
  potenciaDeclarada?: Decimal | string | null;
  actividadDeclarada?: Decimal | string | null;
}): FactorPotencia {
  if (partida.actividadDeclarada !== null && partida.actividadDeclarada !== undefined) {
    return { tipo: "ACTIVIDAD", uiPorGramo: partida.actividadDeclarada };
  }
  return { tipo: "PORCENTAJE", valor: potenciaEfectiva(partida.potenciaDeclarada) };
}

/** The potencia used in calculations: the declared one, or 100 when none was declared. */
export function potenciaEfectiva(potencia: Decimal | string | null | undefined): Decimal {
  return potencia === null || potencia === undefined ? dec(POTENCIA_SIN_CORRECCION) : dec(potencia);
}

/** `true` when the factor actually applies a correction (ACTIVIDAD, or PORCENTAJE < 100%). */
export function tieneCorreccion(factor: FactorPotenciaInput): boolean {
  const f = normalizarFactor(factor);
  if (f.tipo === "ACTIVIDAD") return true;
  return dec(f.valor).lessThan(POTENCIA_SIN_CORRECCION);
}

/**
 * Active ingredient contained in `fisico` (in `unidadStock`, default GRAMO for ACTIVIDAD)
 * of a partida with `factor`.
 */
export function activoDesdeFisico(
  fisico: Decimal | string,
  factor: FactorPotenciaInput,
  unidadStock: UnidadDeConversion = UNIDAD_GRAMO,
): Decimal {
  const f = normalizarFactor(factor);
  if (f.tipo === "ACTIVIDAD") {
    const fisicoEnGramos = convertirCantidad(fisico, unidadStock, UNIDAD_GRAMO);
    return fisicoEnGramos.times(dec(f.uiPorGramo));
  }
  const p = dec(f.valor);
  return p.equals(POTENCIA_SIN_CORRECCION) ? dec(fisico) : dec(fisico).times(p).dividedBy(100);
}

/**
 * Physical weight (in `unidadStock`, default GRAMO for ACTIVIDAD) of a partida with `factor`
 * that contains `activo` (rounded up -- see module doc comment).
 */
export function fisicoParaActivo(
  activo: Decimal | string,
  factor: FactorPotenciaInput,
  unidadStock: UnidadDeConversion = UNIDAD_GRAMO,
): Decimal {
  const f = normalizarFactor(factor);
  if (f.tipo === "ACTIVIDAD") {
    const gramos = dec(activo).dividedBy(dec(f.uiPorGramo));
    const enUnidadStock = convertirCantidad(gramos, UNIDAD_GRAMO, unidadStock);
    return enUnidadStock.toDecimalPlaces(DECIMALES_PESO_FISICO, Decimal.ROUND_UP);
  }
  const p = dec(f.valor);
  if (p.equals(POTENCIA_SIN_CORRECCION)) return dec(activo);
  return dec(activo).times(100).dividedBy(p).toDecimalPlaces(DECIMALES_PESO_FISICO, Decimal.ROUND_UP);
}

export interface PartidaConPotencia extends PartidaDisponible {
  /** `partida.potencia_declarada` (percent), `null` = 100%. */
  potenciaDeclarada: string | null;
  /** `partida.actividad_declarada` (U.I./g), `null` when the lot is in mass/%. */
  actividadDeclarada?: string | null;
}

export interface RepartoActivoLinea {
  partidaId: string;
  /** PHYSICAL quantity to consume from this partida (what `movimiento_stock.cantidad` records). */
  cantidad: Decimal;
  /** Active ingredient this consumption contributes. */
  activo: Decimal;
  /** The potencia applied (percent, 100 when the partida declares none), or null when the lot is in ACTIVIDAD -- `movimiento_stock.potencia_aplicada`. */
  potenciaAplicada: Decimal | null;
  /** The activity applied (U.I./g) when the lot is in ACTIVIDAD -- `movimiento_stock.actividad_aplicada`. */
  actividadAplicada: Decimal | null;
}

export type RepartoActivoResultado =
  | { ok: true; lineas: readonly RepartoActivoLinea[]; totalFisico: Decimal }
  | { ok: false; motivo: "STOCK_INSUFICIENTE"; /** In ACTIVE terms (same unit as the línea's cantidadAPesar). */ faltante: Decimal };

/**
 * Splits `activoRequerido` across `partidas` in ACTIVE terms, draining them
 * in `proponerReparto`'s order (abiertas first, then FEFO; vencidas and
 * empty partidas skipped). Satisfied when the active sum reaches `activoRequerido`;
 * otherwise STOCK_INSUFICIENTE with the active shortfall.
 */
export function proponerRepartoActivo(
  partidas: readonly PartidaConPotencia[],
  activoRequerido: Decimal | string,
  jornadaActual: string,
  unidadStock: UnidadDeConversion = UNIDAD_GRAMO,
): RepartoActivoResultado {
  const requerido = dec(activoRequerido);
  if (!requerido.greaterThan(0)) {
    throw new RangeError("proponerRepartoActivo: activoRequerido must be greater than zero.");
  }

  const lineas: RepartoActivoLinea[] = [];
  let restante = requerido;
  let totalFisico = dec(0);

  for (const partida of ordenarParaConsumo(partidas, jornadaActual)) {
    if (!restante.greaterThan(0)) break;
    const factor = factorDePartida(partida);
    const disponible = dec(partida.cantidadDisponible);
    const activoDisponible = activoDesdeFisico(disponible, factor, unidadStock);

    let cantidad: Decimal;
    let activo: Decimal;
    if (activoDisponible.greaterThan(restante)) {
      cantidad = Decimal.min(fisicoParaActivo(restante, factor, unidadStock), disponible);
      activo = restante;
    } else {
      cantidad = disponible;
      activo = activoDisponible;
    }

    lineas.push({
      partidaId: partida.id,
      cantidad,
      activo,
      potenciaAplicada: factor.tipo === "PORCENTAJE" ? dec(factor.valor) : null,
      actividadAplicada: factor.tipo === "ACTIVIDAD" ? dec(factor.uiPorGramo) : null,
    });
    totalFisico = totalFisico.plus(cantidad);
    restante = restante.minus(activo);
  }

  if (restante.greaterThan(0)) {
    return { ok: false, motivo: "STOCK_INSUFICIENTE", faltante: restante };
  }
  return { ok: true, lineas, totalFisico };
}
