/**
 * Zod schema for one etiqueta measure (ancho/alto) typed in a form. Accepts
 * a number or a string read like every typed number (`interpretarNumero`:
 * comma decimals, a dot only where it can not be thousands) and yields a
 * plain `number` within the limits of `domain/etiqueta-tamano.ts`.
 * Scientific notation, hex and the like are rejected on purpose.
 */
import { z } from "zod";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";
import { TAMANO_MM_MAX, TAMANO_MM_MIN, medidaMmValida } from "../domain/etiqueta-tamano";

export const medidaMmInput = z
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
  .refine((valor) => valor < TAMANO_MM_MIN || valor > TAMANO_MM_MAX || medidaMmValida(valor), { message: "Use como máximo un decimal." })
  .refine((valor) => valor >= TAMANO_MM_MIN && valor <= TAMANO_MM_MAX, { message: `Debe estar entre ${TAMANO_MM_MIN} y ${TAMANO_MM_MAX} mm.` });
