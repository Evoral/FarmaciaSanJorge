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
 * A UNIT cost: at least 2 decimals, up to 6, trailing zeros beyond the second
 * dropped ("1234.5" -> "1.234,50", "0.0035" -> "0,0035"). Costs are recorded
 * per unidad base (mg, mL...) and can be far below one cent, where
 * `formatearMonto`'s fixed 2 decimals would read as "0,00".
 */
export function formatearCostoUnitario(valor: string): string {
  const [entero, fraccion] = dec(valor).toFixed(6).split(".");
  const recortada = fraccion!.replace(/0+$/, "").padEnd(2, "0");
  return agruparEsAr(entero!, recortada);
}
