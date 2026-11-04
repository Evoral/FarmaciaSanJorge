/**
 * The excipiente typed per unidad (migration 0113, openspec/specs/excipiente-preparacion/spec.md): in a forma counted
 * by units (CAPSULA, COMPRIMIDO, OVULO, SUPOSITORIO) it may be typed as the weight of one unit (one cápsula: what the
 * pharmacist thinks in, even when a cápsula holds half a dosis) or as c.s.p. (the weight of the whole preparado, every
 * forma). Either way the excipiente to weigh is that weight minus the drogas' weight (`cantidadExcipienteAPesar`),
 * unless something is not a weight (then an enrase as typed). The stock and the ficha use the total; typed per unidad,
 * the libro's fórmula carries the excipiente per dosis, like the activos beside it.
 * Pure, no I/O.
 */
import { type Decimal, dec } from "@/shared/decimal";
import type { UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import { formatNumero } from "@/shared/format/cantidad";
import { FORMAS_POR_UNIDAD } from "./etiqueta";
import { TEXTO_INSUMO_MAX } from "./insumo";

/** What the ítem's units and dosis are computed from. */
export interface ItemDosificable {
  formaFarmaceutica: string;
  cantidadUnidades: number;
  /** Decimal string in (0, 1]: how much of a dosis one unit holds. */
  fraccionDosisPorUnidad: string;
}

/**
 * The ítem's number of dosis -- unidades × fracción, as the ficha multiplies a POR_DOSIS componente -- or `null` when
 * its forma is not counted by units.
 */
export function dosisDelItem(item: ItemDosificable): Decimal | null {
  if (!FORMAS_POR_UNIDAD.has(item.formaFarmaceutica) || item.cantidadUnidades <= 0) return null;
  return dec(item.fraccionDosisPorUnidad).times(item.cantidadUnidades);
}

/** The unit's name, singular and plural ("cápsula", "cápsulas"), of a forma counted by units. */
const NOMBRE_UNIDAD: Record<string, readonly [string, string]> = {
  CAPSULA: ["cápsula", "cápsulas"],
  COMPRIMIDO: ["comprimido", "comprimidos"],
  OVULO: ["óvulo", "óvulos"],
  SUPOSITORIO: ["supositorio", "supositorios"],
};

/** An ítem the excipiente may be typed per unidad for. */
export interface UnidadesDelItem {
  cantidad: Decimal;
  dosis: Decimal;
  singular: string;
  plural: string;
}

/** The ítem's units (and dosis, for the libro), or `null` when its forma is not counted by units: c.s.p. only. */
export function unidadesDelItem(item: ItemDosificable): UnidadesDelItem | null {
  const dosis = dosisDelItem(item);
  const nombre = NOMBRE_UNIDAD[item.formaFarmaceutica];
  if (!dosis || !dosis.greaterThan(0) || !nombre) return null;
  return { cantidad: dec(item.cantidadUnidades), dosis, singular: nombre[0], plural: nombre[1] };
}

/** A ficha línea as the c.s.p. needs it: its quantity to weigh, in its unit. */
export interface LineaConPeso {
  cantidadAPesar: string | null;
  esEnraseManual: boolean;
  unidad: UnidadDeConversion;
}

/**
 * The drogas' weight to weigh (the ficha's cantidad a pesar), in the base unit of MASA -- what the c.s.p. subtracts.
 * `null` when a línea is not a fixed weight (a volume, units, an enrase manual): nothing can be subtracted.
 */
export function pesoDeDrogas(lineas: readonly LineaConPeso[]): Decimal | null {
  let suma = dec(0);
  for (const linea of lineas) {
    if (linea.esEnraseManual || linea.cantidadAPesar === null || linea.unidad.tipoMagnitud !== "MASA") return null;
    suma = suma.plus(dec(linea.cantidadAPesar).times(linea.unidad.factorABase));
  }
  return suma;
}

/** The excipiente to weigh, in its unidad base. */
export interface ExcipienteAPesar {
  /** What is reserved and descontado. Not positive when the drogas weigh as much as the weight typed. */
  total: Decimal;
  /** Typed per unidad: the excipiente in one unit (the ficha) and in one dosis (the libro); `null` as c.s.p. */
  porUnidad: Decimal | null;
  porDosis: Decimal | null;
  /** The drogas subtracted, in the excipiente's unidad base; `null` when not subtracted (an enrase as typed). */
  drogas: Decimal | null;
}

/**
 * c.s.p.: the preparado's weight typed minus the drogas (12 g − 0,075 g = 11,925 g). Per unidad: one unit's weight
 * times the units, minus the drogas (0,4 g × 30 − 0,075 g = 11,925 g, 0,3975 g per cápsula). Only when the excipiente
 * and every droga are weights (`pesoDrogas` not `null`, from `pesoDeDrogas`); otherwise the quantity typed is the
 * excipiente's, as an enrase.
 */
export function cantidadExcipienteAPesar(input: {
  cantidad: Decimal | string;
  /** The ítem's units when typed per unidad; `null` as c.s.p. */
  unidades: { cantidad: Decimal | string; dosis: Decimal | string } | null;
  pesoDrogas: Decimal | null;
  unidad: UnidadDeConversion;
}): ExcipienteAPesar {
  const drogas = input.pesoDrogas !== null && input.unidad.tipoMagnitud === "MASA" ? input.pesoDrogas.dividedBy(input.unidad.factorABase) : null;
  const cantidad = dec(input.cantidad);
  const cargado = input.unidades ? cantidad.times(input.unidades.cantidad) : cantidad;
  const total = drogas ? cargado.minus(drogas) : cargado;
  if (!input.unidades) return { total, porUnidad: null, porDosis: null, drogas };
  return {
    total,
    porUnidad: drogas ? total.dividedBy(input.unidades.cantidad).toDecimalPlaces(6) : cantidad,
    porDosis: total.dividedBy(input.unidades.dosis).toDecimalPlaces(6),
    drogas,
  };
}

/**
 * The excipiente's fórmula text (`preparacion.excipiente_texto`; the libro appends "c.s.p."): "Ludipress 0,795 g" per
 * dosis when typed per unidad, "Ludipress" as c.s.p. -- a total next to activos per dosis read as if each dosis carried it.
 */
export function textoFormulaExcipiente(drogaNombre: string, unidadSimbolo: string, cantidadPorDosis: Decimal | string | null): string {
  const texto = cantidadPorDosis === null ? drogaNombre : `${drogaNombre} ${formatNumero(dec(cantidadPorDosis).toString())} ${unidadSimbolo}`;
  return texto.slice(0, TEXTO_INSUMO_MAX);
}

/** "= 0,3975 g por cápsula": the printed ficha's line under the excipiente's total. */
export function textoExcipientePorUnidad(cantidadPorUnidad: Decimal | string, unidadSimbolo: string, singular: string): string {
  return `= ${formatNumero(dec(cantidadPorUnidad).toString())} ${unidadSimbolo} por ${singular}`;
}

/** "0,3975 g × 30 cápsulas": the breakdown shown under the total. */
export function textoDesglosePorUnidad(cantidadPorUnidad: Decimal | string, unidadSimbolo: string, unidades: Decimal | string, plural: string): string {
  return `${formatNumero(dec(cantidadPorUnidad).toString())} ${unidadSimbolo} × ${formatNumero(dec(unidades).toString())} ${plural}`;
}
