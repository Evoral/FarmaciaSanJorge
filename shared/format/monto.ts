/**
 * Money for display, es-AR convention (`1.234,56`). Pure, no I/O. Decimal
 * strings in, text out, with `decimal.js` end to end (INV-PL-003: never
 * IEEE-754 floats for amounts). DISPLAY ONLY: nothing here may feed a stored
 * value. Callers prefix the currency symbol themselves.
 */
import { dec } from "@/shared/decimal";

/** Groups the integer digits with dots and joins the fraction with a comma. Negative sign preserved. */
function agruparEsAr(entero: string, fraccion: string): string {
  const signo = entero.startsWith("-") ? "-" : "";
  const digitos = signo ? entero.slice(1) : entero;
  return `${signo}${digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraccion}`;
}

/** "1234.5" -> "1.234,50" (es-AR, 2 decimals, no float round-trip). */
export function formatearMonto(valor: string): string {
  const [entero, fraccion] = dec(valor).toFixed(2).split(".");
  return agruparEsAr(entero!, fraccion!);
}

/**
 * A UNIT cost or a price: 2 decimals, or as many more (up to 6) as it takes
 * for a non-zero value not to read as "0,00" ("1234.567" -> "1.234,57",
 * "0.0035" -> "0,004"; a non-zero cost below 0,0000005 -> "< 0,000001").
 * Costs are recorded per unidad base (mg, mL...) and can be far below one
 * cent, where `formatearMonto`'s fixed 2 decimals would read as "0,00".
 */
export function formatearCostoUnitario(valor: string): string {
  const numero = dec(valor);
  // A non-zero cost that still rounds to zero at 6 decimals must not read as free.
  if (!numero.isZero() && dec(numero.toFixed(6)).isZero()) return numero.isNegative() ? "> -0,000001" : "< 0,000001";
  let decimales = 2;
  while (decimales < 6 && !numero.isZero() && dec(numero.toFixed(decimales)).isZero()) decimales++;
  const [entero, fraccion] = numero.toFixed(decimales).split(".");
  return agruparEsAr(entero!, fraccion!);
}
