/**
 * Pure value object for a partida's declared activity (U.I. per gram of physical lot).
 * Migration 0133 (`partida.actividad_declarada`), openspec/specs/unidad-internacional/spec.md (UI4).
 *
 * Parses certificate expressions like:
 *   - "1000 U.I. cada 10 g"   -> 100 U.I./g
 *   - "10 g cada 1000 U.I."   -> 100 U.I./g
 *   - "500 U.I. cada 500 mg"  -> 1000 U.I./g
 *   - "100 U.I./g"            -> 100 U.I./g
 *
 * All arithmetic uses `Decimal` (decimal.js); numeric strings go through `interpretarNumero`
 * so es-AR comma decimals and ambiguous thousands dots follow the repo's number-input spec.
 */
import { Decimal, dec } from "@/shared/decimal";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";

export type CodigoUnidadMasaActividad = "MICROGRAMO" | "MILIGRAMO" | "GRAMO" | "KILOGRAMO";

/** Factor to convert 1 unit of mass into GRAMO (`fsj.unidad_medida.factor_a_base` for MASA). */
export const FACTOR_MASA_A_GRAMO: Readonly<Record<CodigoUnidadMasaActividad, string>> = {
  MICROGRAMO: "0.000001",
  MILIGRAMO: "0.001",
  GRAMO: "1",
  KILOGRAMO: "1000",
};

const ALIAS_MASA: Readonly<Record<string, CodigoUnidadMasaActividad>> = {
  mcg: "MICROGRAMO",
  ug: "MICROGRAMO",
  "μg": "MICROGRAMO",
  microgramo: "MICROGRAMO",
  microgramos: "MICROGRAMO",
  mg: "MILIGRAMO",
  miligramo: "MILIGRAMO",
  miligramos: "MILIGRAMO",
  g: "GRAMO",
  gr: "GRAMO",
  grs: "GRAMO",
  gramo: "GRAMO",
  gramos: "GRAMO",
  kg: "KILOGRAMO",
  kilogramo: "KILOGRAMO",
  kilogramos: "KILOGRAMO",
};

export type ParsearActividadResultado =
  | { ok: true; uiPorGramo: Decimal }
  | { ok: false; mensaje: string };

/**
 * Computes U.I. per gram from `(ui, masa, unidadMasa)`.
 * Rejects non-positive values (`RangeError`).
 */
export function actividadDesdeRelacion(
  ui: Decimal | string,
  masa: Decimal | string,
  unidadMasa: CodigoUnidadMasaActividad,
): Decimal {
  const uiDec = dec(ui);
  const masaDec = dec(masa);
  if (!uiDec.greaterThan(0) || !masaDec.greaterThan(0)) {
    throw new RangeError("actividadDesdeRelacion: ui and masa must be greater than zero.");
  }
  const masaEnGramos = masaDec.times(FACTOR_MASA_A_GRAMO[unidadMasa]);
  return uiDec.dividedBy(masaEnGramos);
}

/**
 * Inverse of `actividadDesdeRelacion`: U.I. contained in `masa` of `unidadMasa`
 * for a lot with `uiPorGramo` U.I./g.
 */
export function uiEnMasa(
  uiPorGramo: Decimal | string,
  masa: Decimal | string,
  unidadMasa: CodigoUnidadMasaActividad = "GRAMO",
): Decimal {
  const actDec = dec(uiPorGramo);
  const masaDec = dec(masa);
  if (!actDec.greaterThan(0) || masaDec.isNegative()) {
    throw new RangeError("uiEnMasa: uiPorGramo must be positive and masa non-negative.");
  }
  const masaEnGramos = masaDec.times(FACTOR_MASA_A_GRAMO[unidadMasa]);
  return actDec.times(masaEnGramos);
}

const TOKEN_UI = /^([^\s]+)\s*u\.?i\.?$/i;
const TOKEN_MASA = /^([^\s]+)\s*([a-zA-Zμ]+)$/;
const SOLO_MASA_SIN_NUMERO = /^([a-zA-Zμ]+)$/;

function parsearNumeroPositivo(raw: string): { ok: true; valor: Decimal } | { ok: false; mensaje: string } {
  const num = interpretarNumero(raw);
  if (!num.ok) return num;
  const valor = dec(num.valor);
  if (!valor.greaterThan(0)) {
    return { ok: false, mensaje: "La cantidad debe ser mayor que cero." };
  }
  return { ok: true, valor };
}

function resolverUnidadMasa(simbolo: string): CodigoUnidadMasaActividad | null {
  return ALIAS_MASA[simbolo.trim().toLowerCase()] ?? null;
}

/**
 * Parses `"X U.I. cada Y <masa>"`, `"Y <masa> cada X U.I."`, or `"X U.I. / Y <masa>"` / `"X U.I./g"`
 * into U.I. per gram (`Decimal`).
 */
export function parsearActividad(texto: string): ParsearActividadResultado {
  const limpio = texto.trim();
  if (!limpio) {
    return { ok: false, mensaje: "Ingresá la actividad (ej. 1000 U.I. cada 10 g)." };
  }

  // Split by "cada" (case-insensitive) or "/"
  const partesCada = limpio.split(/\s+cada\s+/i);
  const partesBarra = partesCada.length === 2 ? null : limpio.split(/\s*\/\s*/);
  const partes = partesCada.length === 2 ? partesCada : partesBarra;

  if (!partes || partes.length !== 2) {
    return {
      ok: false,
      mensaje: 'Formato inválido. Usá "X U.I. cada Y g" (o mg, mcg, kg), o "Y g cada X U.I.".',
    };
  }

  const [izq, der] = [partes[0]!.trim(), partes[1]!.trim()];

  // Case 1: "<X> U.I." on left, "<Y> <masa>" (or "<masa>" when using "/") on right
  const mUiIzq = izq.match(TOKEN_UI);
  if (mUiIzq) {
    const uiRes = parsearNumeroPositivo(mUiIzq[1]!);
    if (!uiRes.ok) return uiRes;

    const mMasaDer = der.match(TOKEN_MASA);
    if (mMasaDer) {
      const unidad = resolverUnidadMasa(mMasaDer[2]!);
      if (!unidad) {
        return { ok: false, mensaje: `Unidad de masa desconocida: "${mMasaDer[2]}". Usá mcg, mg, g o kg.` };
      }
      const masaRes = parsearNumeroPositivo(mMasaDer[1]!);
      if (!masaRes.ok) return masaRes;
      return { ok: true, uiPorGramo: actividadDesdeRelacion(uiRes.valor, masaRes.valor, unidad) };
    }

    // Allow "100 U.I./g" (implicit 1 when separated by "/")
    if (partesBarra) {
      const mSoloUnidad = der.match(SOLO_MASA_SIN_NUMERO);
      if (mSoloUnidad) {
        const unidad = resolverUnidadMasa(mSoloUnidad[1]!);
        if (unidad) {
          return { ok: true, uiPorGramo: actividadDesdeRelacion(uiRes.valor, "1", unidad) };
        }
      }
    }

    return { ok: false, mensaje: 'Indicá la masa con su unidad (ej. "10 g" o "500 mg").' };
  }

  // Case 2: "<Y> <masa>" on left, "<X> U.I." on right (only with "cada")
  const mUiDer = der.match(TOKEN_UI);
  const mMasaIzq = izq.match(TOKEN_MASA);
  if (partesCada.length === 2 && mUiDer && mMasaIzq) {
    const unidad = resolverUnidadMasa(mMasaIzq[2]!);
    if (!unidad) {
      return { ok: false, mensaje: `Unidad de masa desconocida: "${mMasaIzq[2]}". Usá mcg, mg, g o kg.` };
    }
    const uiRes = parsearNumeroPositivo(mUiDer[1]!);
    if (!uiRes.ok) return uiRes;
    const masaRes = parsearNumeroPositivo(mMasaIzq[1]!);
    if (!masaRes.ok) return masaRes;
    return { ok: true, uiPorGramo: actividadDesdeRelacion(uiRes.valor, masaRes.valor, unidad) };
  }

  return {
    ok: false,
    mensaje: 'Formato inválido. Usá "X U.I. cada Y g" (o mg, mcg, kg), o "Y g cada X U.I.".',
  };
}
