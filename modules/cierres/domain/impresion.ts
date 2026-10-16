/**
 * Print order of the libro's daily sheets (docs/specs/libro-recetario-y-contralor.md, "Impresión"): the sheets are
 * printed in date order. While a signed jornada has never been printed, no later jornada can be printed (nor
 * reprinted); that one and any earlier one can.
 */
import { formatFechaIso } from "@/shared/format/fecha";

/** `primerSinImprimir`: the oldest signed jornada never printed (YYYY-MM-DD), or `null` when every one was. */
export function puedeImprimirJornada(fecha: string, primerSinImprimir: string | null): boolean {
  return primerSinImprimir === null || fecha <= primerSinImprimir;
}

export function mensajeImpresionFueraDeOrden(primerSinImprimir: string): string {
  return `Primero imprimí la hoja del ${formatFechaIso(primerSinImprimir)}: las hojas del libro se imprimen en orden.`;
}
