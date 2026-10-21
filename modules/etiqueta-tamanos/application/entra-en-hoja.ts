/**
 * The fit rule of docs/specs/hoja-etiquetas.md R5, shared by crear / editar /
 * reactivar a size: a label size must fit the sheet at least once. The caller has
 * already locked the sheet row (`lockEtiquetaHojaCompartida`) so no sheet edit can
 * commit between this check and the write.
 */
import { ValidationError } from "@/shared/errors";
import { areaUtilMm, camposQueNoEntran, entraEnHoja, formatearHoja } from "../domain/etiqueta-hoja";
import type { HojaEtiqueta } from "../domain/etiqueta-hoja";
import { formatearMedidas } from "../domain/etiqueta-tamano";
import type { TamanoEtiqueta } from "../domain/etiqueta-tamano";

/** The message for a size that does not fit `hoja`. */
export function mensajeNoEntraEnHoja(hoja: HojaEtiqueta): string {
  return `El tamaño no entra en la hoja (${formatearHoja(hoja)}): el máximo es ${formatearMedidas(areaUtilMm(hoja))}.`;
}

/** Throws a `ValidationError` marking the measure(s) that do not fit when `tamano` does not fit `hoja`. */
export function exigirQueEntreEnHoja(hoja: HojaEtiqueta, tamano: TamanoEtiqueta): void {
  if (entraEnHoja(hoja, tamano)) return;
  throw new ValidationError(mensajeNoEntraEnHoja(hoja), { fields: camposQueNoEntran(hoja, tamano) });
}
