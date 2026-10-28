/**
 * Default cell of an ítem row in the toma's "Imprimir etiquetas" dialog (openspec/specs/hoja-etiquetas/spec.md R11).
 * Pure; nothing is persisted: the dialog keeps the last printed cell only while it is open.
 *
 * The farmacia feeds the same sheet back and prints the next etiqueta in the next free spot, so once an ítem
 * is printed every row the user has not touched yet and that has the SAME size defaults to the next cell in
 * reading order after the last printed one (wrapping to 1 / 1 after the last cell). A row with another size
 * keeps 1 / 1: positions of different grids are not comparable.
 */
import { siguienteCelda } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { Celda, Grilla } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";

/** The last etiqueta sent to print while the dialog is open. */
export interface UltimaImpresion {
  tamanoId: string;
  celda: Celda;
}

/** The cell an untouched row of size `tamanoId` (whose grid is `grilla`) shows. */
export function celdaPorDefecto(grilla: Grilla, tamanoId: string, ultima: UltimaImpresion | null): Celda {
  if (!ultima || ultima.tamanoId !== tamanoId) return { columna: 1, fila: 1 };
  return siguienteCelda(grilla, ultima.celda);
}
