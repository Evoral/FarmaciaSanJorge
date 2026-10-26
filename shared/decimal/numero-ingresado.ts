/**
 * How a number TYPED by a user is read (openspec/specs/numeros-ingresados/spec.md). The lab writes es-AR numbers -- comma for
 * decimals, dot for thousands -- while `new Decimal()` reads "1.500" as one and a half: a silent 1000x error in a
 * weight or a price. Every place that turns user input into a quantity or an amount goes through
 * `interpretarNumero`; nothing is ever guessed:
 *
 *   - comma = decimal separator: "1,5" -> 1.5, ",5" -> 0.5;
 *   - dot + comma = es-AR thousands + decimals: "1.234,5" -> 1234.5 (dots only in groups of three);
 *   - a dot alone is read as a decimal point when it can not be a thousands separator ("0.015", "12.5", "1.25") --
 *     what the forms accepted until now;
 *   - a dot alone that COULD be thousands ("1.500", "12.000", "1.234.567") is refused with a message that offers
 *     both readings: the user decides;
 *   - spaces are ignored; anything else (letters, "1e3", two commas) is refused.
 *
 * Pure (no server imports): the zod schemas at the server edge and the forms' live previews read the same.
 * Prefilled form values go through `numeroParaInput`, so saving an edit form untouched never trips the ambiguity
 * rule (a stored 1.234 is shown as "1,234").
 */
import { Decimal } from "decimal.js";

export type NumeroIngresado = { ok: true; /** Canonical, for `new Decimal()`: "1234.5". */ valor: string } | { ok: false; mensaje: string };

/** The help shown next to numeric fields and appended to every refusal. */
export const AYUDA_NUMERO = "Usá coma para los decimales (1,5) y no separes los miles (1500).";

const SIN_SEPARADOR = /^\d+$/;
const COMA_DECIMAL = /^\d*,\d+$/;
const MILES_Y_COMA = /^\d{1,3}(\.\d{3})+,\d+$/;
const PUNTO_COMO_MILES = /^\d{1,3}(\.\d{3})+$/;
const PUNTO_DECIMAL = /^\d*\.\d+$/;

export function interpretarNumero(texto: string): NumeroIngresado {
  const limpio = texto.replace(/[\s ]/g, "");
  if (limpio.length === 0) return { ok: false, mensaje: "Este campo no puede estar vacío." };
  const signo = limpio.startsWith("-") ? "-" : "";
  const cuerpo = signo ? limpio.slice(1) : limpio;

  if (SIN_SEPARADOR.test(cuerpo)) return { ok: true, valor: signo + cuerpo };
  if (COMA_DECIMAL.test(cuerpo)) return { ok: true, valor: signo + (cuerpo.startsWith(",") ? "0" : "") + cuerpo.replace(",", ".") };
  if (MILES_Y_COMA.test(cuerpo)) return { ok: true, valor: signo + cuerpo.replace(/\./g, "").replace(",", ".") };
  // "0.500" can not be thousands (no number starts with a 0 group): a decimal point.
  if (PUNTO_COMO_MILES.test(cuerpo) && !cuerpo.startsWith("0")) {
    const miles = cuerpo.replace(/\./g, "");
    const partes = cuerpo.split(".");
    // The decimal reading without trailing zeros: "1.500" -> "1,5", "12.000" -> "12".
    const fraccion = partes.length === 2 ? partes[1]!.replace(/0+$/, "") : "";
    const decimal = partes.length === 2 ? (fraccion ? `${partes[0]},${fraccion}` : partes[0]!) : null;
    return {
      ok: false,
      mensaje: decimal
        ? `"${texto.trim()}" es ambiguo: escribí ${signo}${miles} (sin punto) o ${signo}${decimal}${decimal.includes(",") ? " (con coma)" : ""}.`
        : `"${texto.trim()}" parece tener puntos de miles: escribí ${signo}${miles}.`,
    };
  }
  if (PUNTO_DECIMAL.test(cuerpo)) return { ok: true, valor: signo + (cuerpo.startsWith(".") ? "0" : "") + cuerpo };
  return { ok: false, mensaje: `"${texto.trim()}" no es un número válido. ${AYUDA_NUMERO}` };
}

/** The canonical value, or `null` when the text is not a number (any reason). */
export function numeroONull(texto: string | null | undefined): string | null {
  if (texto == null) return null;
  const resultado = interpretarNumero(texto);
  return resultado.ok ? resultado.valor : null;
}

/** A stored number ("1234.5", a `Decimal`'s `toString()`) as a form prefill: comma decimals, no thousands ("1234,5"). */
export function numeroParaInput(valor: string | number | null | undefined): string {
  if (valor == null || valor === "") return "";
  let texto = String(valor);
  // A Decimal prints tiny/huge values in exponent notation ("1e-7"): expand it.
  if (/e/i.test(texto)) {
    try {
      texto = new Decimal(texto).toFixed();
    } catch {
      return texto;
    }
  }
  return texto.replace(".", ",");
}
