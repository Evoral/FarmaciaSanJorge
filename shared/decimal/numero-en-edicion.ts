/**
 * Thousands dots while a number is being typed (display only): "1234567,5" shows as "1.234.567,5". Every dot in an
 * edited field is one of these groupings -- a typed "." becomes the decimal comma (`shared/ui/numero-input.tsx`) --
 * and the value the form submits or the state keeps has them removed (`quitarMiles`), so the server keeps reading
 * exactly what it read before (`interpretarNumero`, shared/decimal/numero-ingresado.ts).
 *
 * Pure (no DOM): the input component and tests use the same functions.
 */
import { interpretarNumero } from "./numero-ingresado";

/** A number being typed in es-AR: optional sign, digits with (our) grouping dots, optional comma and decimals. */
const EN_EDICION = /^-?[\d.]*(,\d*)?$/;

function sinEspacios(texto: string): string {
  return texto.replace(/[\s ]/g, "");
}

/** Whether `texto` reads as a number being typed (so its dots are groupings and it can be regrouped). */
export function esNumeroEnEdicion(texto: string): boolean {
  return EN_EDICION.test(sinEspacios(texto));
}

/** Regroups the integer part with dots ("1234,5" -> "1.234,5", "1.23.4" -> "1.234"); text that is not a number being typed comes back as is. */
export function agruparMiles(texto: string): string {
  const limpio = sinEspacios(texto);
  if (!EN_EDICION.test(limpio)) return texto;
  const signo = limpio.startsWith("-") ? "-" : "";
  const coma = limpio.indexOf(",");
  const entero = (coma < 0 ? limpio.slice(signo.length) : limpio.slice(signo.length, coma)).replace(/\./g, "");
  const decimales = coma < 0 ? "" : limpio.slice(coma);
  return signo + entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + decimales;
}

/** The inverse of `agruparMiles`: the text without its grouping dots ("1.234,5" -> "1234,5"), the value to submit. */
export function quitarMiles(texto: string): string {
  const limpio = sinEspacios(texto);
  return EN_EDICION.test(limpio) ? limpio.replace(/\./g, "") : texto;
}

/**
 * A value coming from outside the field (a prefill, the state) as the field shows it. Values from the field itself
 * never hold a dot; a single dot without a comma is a canonical decimal point ("1.5", a `Decimal`'s `toString()`).
 */
export function numeroParaEdicion(valor: string | null | undefined): string {
  const texto = valor ?? "";
  if (texto.includes(",") || (texto.match(/\./g)?.length ?? 0) !== 1) return agruparMiles(texto);
  const conComa = texto.replace(".", ",");
  return EN_EDICION.test(sinEspacios(conComa)) ? agruparMiles(conComa) : texto;
}

/**
 * Pasted text as it should be inserted: a number read by `interpretarNumero` with a comma decimal ("12.5" -> "12,5",
 * "1.234,5" -> "1234,5"); anything else as pasted, without spaces (its dots then read as thousands, as shown).
 */
export function textoPegado(texto: string): string {
  const numero = interpretarNumero(texto);
  return numero.ok ? numero.valor.replace(".", ",") : sinEspacios(texto);
}

/** How many characters other than grouping dots sit before `posicion`. */
export function significativosAntes(texto: string, posicion: number): number {
  let cuenta = 0;
  for (let i = 0; i < Math.min(posicion, texto.length); i++) if (texto[i] !== ".") cuenta++;
  return cuenta;
}

/** The caret position in `texto` right after its `significativos`-th character other than a grouping dot. */
export function posicionTrasSignificativos(texto: string, significativos: number): number {
  if (significativos <= 0) return 0;
  let cuenta = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] !== ".") cuenta++;
    if (cuenta === significativos) return i + 1;
  }
  return texto.length;
}
