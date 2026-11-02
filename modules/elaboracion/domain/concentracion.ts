/**
 * A componente expressed as a concentration over its item's total ("vitamina B6 5 %", "5 mg/mL" in a crema c.s.p.
 * 100 g -- migration 0112). Pure, no I/O.
 *
 * - **%** (no reference unit): valor per 100 base units (g or mL) of the total. The componente's unit only gives the
 *   magnitude of the result: masa/masa p/p, masa/volumen p/v, volumen/volumen v/v, volumen/masa v/p.
 * - **per unit** (a reference unit, mL in mg/mL): valor, in the componente's unit, per 1 reference unit of the total.
 */
import { Decimal, dec } from "@/shared/decimal";

/** The magnitudes a total can be expressed in for a concentration to make sense (never UNIDADES). */
export const MAGNITUDES_CONCENTRACION: ReadonlySet<string> = new Set(["MASA", "VOLUMEN"]);

/** The fields of a unit the calculation needs (same meaning as `UnidadMedidaRef`). */
interface UnidadParaConcentracion {
  tipoMagnitud: string;
  factorABase: Decimal | string | number;
}

/**
 * The componente's theoretical quantity, in the base unit of its own magnitude. `totalEnBase` is the item's total in
 * the base unit of its magnitude. The caller has already checked the magnitudes (`problemaConcentracion`).
 */
export function cantidadDesdeConcentracion(
  valor: Decimal | string | number,
  unidad: UnidadParaConcentracion,
  referencia: UnidadParaConcentracion | null,
  totalEnBase: Decimal,
): Decimal {
  if (referencia === null) return dec(valor).dividedBy(100).times(totalEnBase);
  const totalEnReferencia = totalEnBase.dividedBy(dec(referencia.factorABase));
  return dec(valor).times(dec(unidad.factorABase)).times(totalEnReferencia);
}

/** Why a concentration can not be computed against `total`, or `null` when it can. */
export type ProblemaConcentracion = "SIN_TOTAL" | "TOTAL_SIN_MAGNITUD" | "PORCENTAJE_SIN_MAGNITUD" | "REFERENCIA_OTRA_MAGNITUD";

export function problemaConcentracion(
  unidad: Pick<UnidadParaConcentracion, "tipoMagnitud">,
  referencia: Pick<UnidadParaConcentracion, "tipoMagnitud"> | null,
  total: Pick<UnidadParaConcentracion, "tipoMagnitud"> | null,
): ProblemaConcentracion | null {
  if (total === null) return "SIN_TOTAL";
  if (!MAGNITUDES_CONCENTRACION.has(total.tipoMagnitud)) return "TOTAL_SIN_MAGNITUD";
  if (referencia === null) return MAGNITUDES_CONCENTRACION.has(unidad.tipoMagnitud) ? null : "PORCENTAJE_SIN_MAGNITUD";
  return referencia.tipoMagnitud === total.tipoMagnitud ? null : "REFERENCIA_OTRA_MAGNITUD";
}

/** The unit a concentration reads with: "%" or "mg/mL". */
export function simboloConcentracion(simboloUnidad: string, simboloReferencia: string | null): string {
  return simboloReferencia === null ? "%" : `${simboloUnidad}/${simboloReferencia}`;
}

/** How a concentration reads as prescribed: "5 %" or "5 mg/mL". */
export function textoConcentracion(valor: { toString(): string }, simboloUnidad: string, simboloReferencia: string | null): string {
  return `${valor.toString()} ${simboloConcentracion(simboloUnidad, simboloReferencia)}`;
}

/**
 * The unit symbol a componente is DISPLAYED with: its own, or the concentration's ("%", "mg/mL"). Readers that only
 * show "cantidad + símbolo" (detail, libro, etiqueta, history) use it so a concentration reads as prescribed.
 */
export function simboloParaMostrar(modoExpresion: string, simboloUnidad: string, simboloReferencia: string | null): string {
  return modoExpresion === "CONCENTRACION" ? simboloConcentracion(simboloUnidad, simboloReferencia) : simboloUnidad;
}
