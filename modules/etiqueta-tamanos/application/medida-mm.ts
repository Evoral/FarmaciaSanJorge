/**
 * Zod schema for one etiqueta measure typed in a form (the label's ancho/alto, the
 * sheet's ancho/alto/margen). Accepts a number or a string read like every typed
 * number (`interpretarNumero`: comma decimals, a dot only where it can not be
 * thousands) and yields a plain `number` within the given limits, with at most one
 * decimal. Scientific notation, hex and the like are rejected on purpose.
 */
import { z } from "zod";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";
import { TAMANO_MM_MAX, TAMANO_MM_MIN, tieneUnDecimal } from "../domain/etiqueta-tamano";

/** A typed measure within [min, max] mm with at most one decimal. */
export function medidaMmEnRango(min: number, max: number) {
  return z
    .union([z.number(), z.string()])
    .transform((valor, ctx) => {
      if (typeof valor === "number") return valor;
      const numero = interpretarNumero(valor);
      if (!numero.ok) {
        ctx.addIssue({ code: "custom", message: numero.mensaje });
        return z.NEVER;
      }
      return Number(numero.valor);
    })
    .refine((valor) => Number.isFinite(valor), { message: "Debe ser un número válido." })
    .refine((valor) => valor < min || valor > max || tieneUnDecimal(valor), { message: "Use como máximo un decimal." })
    .refine((valor) => valor >= min && valor <= max, { message: `Debe estar entre ${min} y ${max} mm.` });
}

/** A label's ancho or alto. */
export const medidaMmInput = medidaMmEnRango(TAMANO_MM_MIN, TAMANO_MM_MAX);
