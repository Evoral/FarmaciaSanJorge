/**
 * Display formatting for stock quantities (stock por droga, partidas,
 * ajustes, kardex, stock valorizado). Pure and dependency-light: no DB
 * access -- callers hand in the global unit catalog (`fsj.unidad_medida`,
 * DP-39) they loaded once per request (see
 * modules/unidades/application/catalogo-unidades.ts), so this file runs the
 * same in a Server Component and in a unit test.
 *
 * DISPLAY ONLY. Nothing here may feed a stored value, a form input or
 * anything submitted to the server: stored quantities stay exact in the
 * droga's unidad base. Conversions use `decimal.js` end to end (INV-PL-003:
 * never IEEE-754 floats for quantities).
 *
 * Rules:
 *   - Only the unit chains whitelisted by `codigo` in `CADENAS_CONVERTIBLES`
 *     are ever converted (masa: mcg/mg/g/kg, volumen: mcL/mL/L). Every
 *     other unit (UNIDAD, and whatever DP-07 adds later) keeps its own
 *     symbol, rounded to 2 decimals. Factors come from the catalog
 *     (`factor_a_base`), never from constants here.
 *   - "auto" (default): the LARGEST unit of the chain in which the value is
 *     >= 1 with at most 4 integer digits (e.g. 0.7 kg -> 700 g); when none
 *     qualifies, the closest one. Rounded to 2 decimals.
 *   - "base" ("Unificar unidades"): the magnitude's base unit (g / mL), up
 *     to 3 decimals.
 *   - Zero is always shown in the magnitude's base unit ("0 g"). A non-zero
 *     value that rounds to zero is shown as "< 0,01 <unidad>" so an
 *     almost-empty partida never reads as empty.
 *   - Numbers use the es-AR convention (`1.234,56`), trailing zeros
 *     stripped. `exacto` carries the unrounded value in the ORIGINAL unit,
 *     for a `title` tooltip.
 *   - `equivalenciasPracticas` / `unidadesPracticas` (ajuste form) only use
 *     the vigente `UNIDADES_PRACTICAS` and never round: the user compares
 *     the saldo with the quantity they type. `UNIDADES_PRACTICAS` is a
 *     `codigo` whitelist, so modules/stock's server-side check of the
 *     ajuste unit shares it (the conversion itself still runs in the DB,
 *     `fsj.convertir`).
 */
import { Decimal } from "@/shared/decimal";

/** The catalog fields this formatter needs (one `fsj.unidad_medida` row; `factorABase` is its numeric(20,10) as text). */
export interface UnidadFormato {
  id: string;
  codigo: string;
  simbolo: string;
  tipoMagnitud: string;
  factorABase: string;
  esBase: boolean;
  /** `false` for a unit dada de baja (it still formats quantities recorded before the baja); omitted = vigente. */
  vigente?: boolean;
}

/** The unit a quantity is recorded in. `simbolo` is the fallback when `id` is not in the catalog. */
export interface UnidadOrigen {
  id: string;
  simbolo: string;
}

export type ModoCantidad = "auto" | "base";

export interface CantidadFormateada {
  /** Rounded, in the chosen display unit: "1,5 g". */
  texto: string;
  /** Exact and unrounded, in the original unit: "1.500 mg". For a `title` tooltip. */
  exacto: string;
}

/**
 * The ONLY units that may be converted, by `codigo`, per magnitude. A unit
 * missing from this list is never converted, even if it shares a
 * `tipo_magnitud` with one that is.
 */
export const CADENAS_CONVERTIBLES: Readonly<Record<string, readonly string[]>> = {
  MASA: ["MICROGRAMO", "MILIGRAMO", "GRAMO", "KILOGRAMO"],
  VOLUMEN: ["MICROLITRO", "MILILITRO", "LITRO"],
};

/**
 * The units a pharmacist actually measures with (spatulas, scales,
 * graduated cylinders), by `codigo`, per magnitude: a subset of
 * `CADENAS_CONVERTIBLES` without mcg/mcL. The ajuste form only offers
 * these (plus the droga's own unidad base, see modules/stock/domain/partida.ts).
 */
export const UNIDADES_PRACTICAS: Readonly<Record<string, readonly string[]>> = {
  MASA: ["MILIGRAMO", "GRAMO", "KILOGRAMO"],
  VOLUMEN: ["MILILITRO", "LITRO"],
};

const DECIMALES_AUTO = 2;
const DECIMALES_BASE = 3;
const LIMITE_ENTERO = new Decimal(10000); // "at most 4 integer digits"

interface UnidadConvertible {
  unidad: UnidadFormato;
  factor: Decimal;
}

export interface CatalogoUnidades {
  readonly porId: ReadonlyMap<string, UnidadFormato>;
  /** tipoMagnitud -> the whitelisted units present in the catalog, largest factor first. */
  readonly cadenas: ReadonlyMap<string, readonly UnidadConvertible[]>;
}

function esConvertible(unidad: UnidadFormato): boolean {
  return CADENAS_CONVERTIBLES[unidad.tipoMagnitud]?.includes(unidad.codigo) ?? false;
}

export function crearCatalogoUnidades(unidades: readonly UnidadFormato[]): CatalogoUnidades {
  const porId = new Map<string, UnidadFormato>();
  const cadenas = new Map<string, UnidadConvertible[]>();
  for (const unidad of unidades) {
    porId.set(unidad.id, unidad);
    if (!esConvertible(unidad)) continue;
    const cadena = cadenas.get(unidad.tipoMagnitud) ?? [];
    cadena.push({ unidad, factor: new Decimal(unidad.factorABase) });
    cadenas.set(unidad.tipoMagnitud, cadena);
  }
  for (const cadena of cadenas.values()) cadena.sort((a, b) => b.factor.comparedTo(a.factor));
  return { porId, cadenas };
}

/** es-AR number: `.` thousands, `,` decimals, trailing zeros stripped. Rounds (ROUND_HALF_UP) only when `maxDecimales` is given. */
export function formatNumero(valor: Decimal | string, maxDecimales?: number): string {
  const numero = typeof valor === "string" ? new Decimal(valor) : valor;
  const redondeado = maxDecimales === undefined ? numero : numero.toDecimalPlaces(maxDecimales);
  const [entero = "0", fraccion = ""] = redondeado.abs().toFixed().split(".");
  const decimales = fraccion.replace(/0+$/, "");
  const signo = redondeado.isNegative() && !redondeado.isZero() ? "-" : "";
  return `${signo}${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${decimales ? `,${decimales}` : ""}`;
}

/** Exact value in its recorded unit (only trailing zeros stripped) -- for legal records such as the libro contralor. */
export function formatCantidadExacta(valor: string, simbolo: string): string {
  const numero = parse(valor);
  return numero === null ? `${valor} ${simbolo}`.trim() : `${formatNumero(numero)} ${simbolo}`.trim();
}

/**
 * One quantity for display. `opciones.en` forces the display unit (used by
 * `formatCantidadesFila`); it is ignored unless it belongs to the same
 * convertible chain as `unidad`.
 */
export function formatCantidad(
  valor: string,
  unidad: UnidadOrigen,
  catalogo: CatalogoUnidades,
  opciones: { modo?: ModoCantidad; en?: UnidadFormato | null } = {},
): CantidadFormateada {
  const numero = parse(valor);
  if (numero === null) return { texto: `${valor} ${unidad.simbolo}`.trim(), exacto: `${valor} ${unidad.simbolo}`.trim() };
  const exacto = `${formatNumero(numero)} ${unidad.simbolo}`.trim();

  const modo = opciones.modo ?? "auto";
  const conversion = contexto(unidad, catalogo);
  if (!conversion) return { texto: redondear(numero, DECIMALES_AUTO, unidad.simbolo), exacto };

  const valorBase = numero.times(conversion.factorOrigen);
  const destino =
    opciones.en && conversion.cadena.some((c) => c.unidad.id === opciones.en!.id)
      ? conversion.cadena.find((c) => c.unidad.id === opciones.en!.id)!
      : modo === "base" || numero.isZero()
        ? conversion.base
        : elegirEnCadena(valorBase.abs(), conversion.cadena);

  const decimales = modo === "base" ? DECIMALES_BASE : DECIMALES_AUTO;
  return { texto: redondear(valorBase.div(destino.factor), decimales, destino.unidad.simbolo), exacto };
}

/**
 * Several quantities of the SAME row (same unit, e.g. stock disponible and
 * stock mínimo) in ONE display unit, chosen from the largest absolute value
 * so the figures stay comparable side by side.
 */
export function formatCantidadesFila(
  valores: readonly string[],
  unidad: UnidadOrigen,
  catalogo: CatalogoUnidades,
  modo: ModoCantidad = "auto",
): CantidadFormateada[] {
  const conversion = contexto(unidad, catalogo);
  let en: UnidadFormato | null = null;
  if (conversion && modo === "auto") {
    const numeros = valores.map(parse).filter((n): n is Decimal => n !== null);
    const mayor = numeros.reduce((max, n) => (n.abs().greaterThan(max) ? n.abs() : max), new Decimal(0));
    en = mayor.isZero() ? conversion.base.unidad : elegirEnCadena(mayor.times(conversion.factorOrigen), conversion.cadena).unidad;
  }
  return valores.map((valor) => formatCantidad(valor, unidad, catalogo, { modo, en }));
}

/** One exact equivalence of a quantity, e.g. `{ unidadId: <g>, texto: "500 g" }`. */
export interface EquivalenciaPractica {
  unidadId: string;
  texto: string;
}

export interface EquivalenciasPracticas {
  primaria: EquivalenciaPractica;
  /** `null` when the unit is not convertible or its magnitude has a single vigente practical unit. */
  secundaria: EquivalenciaPractica | null;
}

/**
 * The vigente `UNIDADES_PRACTICAS` of `unidad`'s magnitude, SMALLEST first
 * (mg, g, kg). Empty when `unidad` is not convertible (UNIDAD, UI, GOTA,
 * %...) or not in the catalog.
 */
export function unidadesPracticas(unidad: UnidadOrigen, catalogo: CatalogoUnidades): UnidadFormato[] {
  return practicasDe(unidad, catalogo)?.practicas.map((c) => c.unidad) ?? [];
}

/**
 * A quantity as two EXACT equivalences in practical units, e.g.
 * 500000000 mcg -> "500 g" + "500.000 mg". Primary: the largest practical
 * unit in which the value is >= 1 (else the smallest one). Secondary: the
 * next SMALLER practical unit, or the next larger one when the primary is
 * already the smallest. No rounding (only trailing zeros stripped). When
 * `unidad` has no practical units, the exact value in `unidad` itself.
 */
export function equivalenciasPracticas(valor: string, unidad: UnidadOrigen, catalogo: CatalogoUnidades): EquivalenciasPracticas {
  const numero = parse(valor);
  const contextoPractico = numero === null ? null : practicasDe(unidad, catalogo);
  if (numero === null || !contextoPractico) {
    return { primaria: { unidadId: unidad.id, texto: formatCantidadExacta(valor, unidad.simbolo) }, secundaria: null };
  }

  const { practicas, factorOrigen } = contextoPractico;
  const valorBase = numero.times(factorOrigen);
  let indicePrimaria = 0;
  for (let i = practicas.length - 1; i >= 0; i--) {
    if (valorBase.abs().div(practicas[i]!.factor).greaterThanOrEqualTo(1)) {
      indicePrimaria = i;
      break;
    }
  }
  const indiceSecundaria = indicePrimaria > 0 ? indicePrimaria - 1 : practicas.length > 1 ? 1 : null;

  const equivalencia = (c: UnidadConvertible): EquivalenciaPractica => ({
    unidadId: c.unidad.id,
    texto: `${formatNumero(valorBase.div(c.factor))} ${c.unidad.simbolo}`.trim(),
  });
  return {
    primaria: equivalencia(practicas[indicePrimaria]!),
    secundaria: indiceSecundaria === null ? null : equivalencia(practicas[indiceSecundaria]!),
  };
}

/** `unidad`'s vigente practical units (smallest first) and its own factor; `null` when there are none. */
function practicasDe(
  unidad: UnidadOrigen,
  catalogo: CatalogoUnidades,
): { factorOrigen: Decimal; practicas: readonly UnidadConvertible[] } | null {
  const conversion = contexto(unidad, catalogo);
  if (!conversion) return null;
  const codigos = UNIDADES_PRACTICAS[conversion.base.unidad.tipoMagnitud] ?? [];
  const practicas = conversion.cadena.filter((c) => codigos.includes(c.unidad.codigo) && c.unidad.vigente !== false).reverse();
  return practicas.length === 0 ? null : { factorOrigen: conversion.factorOrigen, practicas };
}

function parse(valor: string): Decimal | null {
  try {
    return new Decimal(valor.trim());
  } catch {
    return null;
  }
}

function contexto(
  unidad: UnidadOrigen,
  catalogo: CatalogoUnidades,
): { factorOrigen: Decimal; cadena: readonly UnidadConvertible[]; base: UnidadConvertible } | null {
  const origen = catalogo.porId.get(unidad.id);
  if (!origen || !esConvertible(origen)) return null;
  const cadena = catalogo.cadenas.get(origen.tipoMagnitud);
  const propia = cadena?.find((c) => c.unidad.id === origen.id);
  if (!cadena || !propia) return null;
  const base = cadena.find((c) => c.unidad.esBase) ?? cadena.find((c) => c.factor.equals(1)) ?? propia;
  return { factorOrigen: propia.factor, cadena, base };
}

/** `cadena` is largest-first. `valorBase` is non-negative and non-zero. */
function elegirEnCadena(valorBase: Decimal, cadena: readonly UnidadConvertible[]): UnidadConvertible {
  for (const candidata of cadena) {
    const valor = valorBase.div(candidata.factor);
    if (valor.greaterThanOrEqualTo(1) && valor.toDecimalPlaces(DECIMALES_AUTO).lessThan(LIMITE_ENTERO)) return candidata;
  }
  // None qualifies: the unit whose value lands closest (in orders of magnitude) to [1, 10000).
  let mejor = cadena[0]!;
  let mejorDistancia: Decimal | null = null;
  for (const candidata of cadena) {
    const valor = valorBase.div(candidata.factor);
    const distancia = valor.lessThan(1) ? Decimal.log10(new Decimal(1).div(valor)) : Decimal.log10(valor.div(LIMITE_ENTERO));
    if (mejorDistancia === null || distancia.lessThan(mejorDistancia)) {
      mejor = candidata;
      mejorDistancia = distancia;
    }
  }
  return mejor;
}

function redondear(valor: Decimal, decimales: number, simbolo: string): string {
  const redondeado = valor.toDecimalPlaces(decimales);
  if (redondeado.isZero() && !valor.isZero()) {
    const minimo = formatNumero(new Decimal(1).div(new Decimal(10).pow(decimales)));
    return `${valor.isNegative() ? "> -" : "< "}${minimo} ${simbolo}`.trim();
  }
  return `${formatNumero(redondeado)} ${simbolo}`.trim();
}
