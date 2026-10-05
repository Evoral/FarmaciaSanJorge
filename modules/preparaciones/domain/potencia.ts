/**
 * Purity (potencia) correction per partida (migration 0058). Pure: no I/O,
 * no Prisma.
 *
 * A drug's purity is a property of the LOT (`partida.potencia_declarada`,
 * percent, NULL = 100%), never of the droga. The ficha técnica is unchanged:
 * `linea_pesaje.cantidad_a_pesar` (theoretical x (1 + exceso)) is the
 * ACTIVE ingredient required. Order of calculation: exceso first (ficha),
 * then purity (here):
 *
 *   physical weight = active x 100 / potencia
 *   active          = physical x potencia / 100
 *
 * Stock (`movimiento_stock.cantidad`) is always decremented in PHYSICAL
 * units. Manual-enrase lines get no correction (the caller does not use
 * this file for them).
 *
 * Rounding: a physical weight derived from a potencia below 100 is rounded
 * UP to `DECIMALES_PESO_FISICO` decimals (never under-dosing), capped at the
 * partida's balance. A partida at 100% is never rounded, so a split over
 * partidas without declared purity is IDENTICAL to
 * `modules/stock/domain/reparto.ts#proponerReparto`'s.
 */
import { Decimal, dec } from "@/shared/decimal";
import { ordenarParaConsumo, type PartidaDisponible } from "@/modules/stock/domain/reparto";

/** NULL potencia = 100% (no correction). */
export const POTENCIA_SIN_CORRECCION = "100";

/**
 * Decimals a purity-corrected physical weight is rounded (up) to, in the droga's unidad base.
 * INV-S12 in the DB (migration 0060, `v_tolerancia` = 10^-4) is sized for this value: change both together.
 */
export const DECIMALES_PESO_FISICO = 4;

/** The potencia used in calculations: the declared one, or 100 when none was declared. */
export function potenciaEfectiva(potencia: Decimal | string | null | undefined): Decimal {
  return potencia === null || potencia === undefined ? dec(POTENCIA_SIN_CORRECCION) : dec(potencia);
}

/** `true` when the partida declares a purity below 100% (i.e. a correction actually applies). */
export function tieneCorreccion(potencia: Decimal | string | null | undefined): boolean {
  return potenciaEfectiva(potencia).lessThan(POTENCIA_SIN_CORRECCION);
}

/** Active ingredient contained in `fisico` of a partida at `potencia` %. */
export function activoDesdeFisico(fisico: Decimal | string, potencia: Decimal | string | null | undefined): Decimal {
  const p = potenciaEfectiva(potencia);
  return p.equals(POTENCIA_SIN_CORRECCION) ? dec(fisico) : dec(fisico).times(p).dividedBy(100);
}

/** Physical weight of a partida at `potencia` % that contains `activo` (rounded up -- see module doc comment). */
export function fisicoParaActivo(activo: Decimal | string, potencia: Decimal | string | null | undefined): Decimal {
  const p = potenciaEfectiva(potencia);
  if (p.equals(POTENCIA_SIN_CORRECCION)) return dec(activo);
  return dec(activo).times(100).dividedBy(p).toDecimalPlaces(DECIMALES_PESO_FISICO, Decimal.ROUND_UP);
}

export interface PartidaConPotencia extends PartidaDisponible {
  /** `partida.potencia_declarada` (percent), `null` = 100%. */
  potenciaDeclarada: string | null;
}

export interface RepartoActivoLinea {
  partidaId: string;
  /** PHYSICAL quantity to consume from this partida (what `movimiento_stock.cantidad` records). */
  cantidad: Decimal;
  /** Active ingredient this consumption contributes. */
  activo: Decimal;
  /** The potencia applied (percent, 100 when the partida declares none) -- `movimiento_stock.potencia_aplicada`. */
  potenciaAplicada: Decimal;
}

export type RepartoActivoResultado =
  | { ok: true; lineas: readonly RepartoActivoLinea[]; totalFisico: Decimal }
  | { ok: false; motivo: "STOCK_INSUFICIENTE"; /** In ACTIVE terms (same unit as the línea's cantidadAPesar). */ faltante: Decimal };

/**
 * Splits `activoRequerido` across `partidas` in ACTIVE terms, draining them
 * in `proponerReparto`'s order (abiertas first, then FEFO; vencidas and
 * empty partidas skipped). Draining a partida of balance D contributes
 * D x p / 100 active; the last partida contributes only the remaining
 * active R, i.e. R x 100 / p physical. Satisfied when the active sum
 * reaches `activoRequerido`; otherwise STOCK_INSUFICIENTE with the active
 * shortfall.
 */
export function proponerRepartoActivo(
  partidas: readonly PartidaConPotencia[],
  activoRequerido: Decimal | string,
  jornadaActual: string,
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
    const potencia = potenciaEfectiva(partida.potenciaDeclarada);
    const disponible = dec(partida.cantidadDisponible);
    const activoDisponible = activoDesdeFisico(disponible, potencia);

    let cantidad: Decimal;
    let activo: Decimal;
    if (activoDisponible.greaterThan(restante)) {
      cantidad = Decimal.min(fisicoParaActivo(restante, potencia), disponible);
      activo = restante;
    } else {
      cantidad = disponible;
      activo = activoDisponible;
    }

    lineas.push({ partidaId: partida.id, cantidad, activo, potenciaAplicada: potencia });
    totalFisico = totalFisico.plus(cantidad);
    restante = restante.minus(activo);
  }

  if (restante.greaterThan(0)) {
    return { ok: false, motivo: "STOCK_INSUFICIENTE", faltante: restante };
  }
  return { ok: true, lineas, totalFisico };
}
