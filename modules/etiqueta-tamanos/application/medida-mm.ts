/**
 * Zod schema for one etiqueta measure (ancho/alto) typed in a form. Accepts
 * a number or a string with "." or "," as decimal separator (the pharmacy
 * types es-AR decimals) and yields a plain `number` within the limits of
 * `domain/etiqueta-tamano.ts`. Scientific notation, hex and the like are
 * rejected on purpose: only plain decimal notation is a valid measure.
 */
import { z } from "zod";
import { TAMANO_MM_MAX, TAMANO_MM_MIN, medidaMmValida } from "../domain/etiqueta-tamano";

const DECIMAL_PLANO = /^\d+([.,]\d+)?$/;

export const medidaMmInput = z
  .union([z.number(), z.string()])
  .transform((valor, ctx) => {
    if (typeof valor === "number") return valor;
    const limpio = valor.trim();
    if (limpio === "") {
      ctx.addIssue({ code: "custom", message: "Este campo no puede estar vacío." });
      return z.NEVER;
    }
    if (!DECIMAL_PLANO.test(limpio)) {
      ctx.addIssue({ code: "custom", message: "Debe ser un número válido." });
      return z.NEVER;
    }
    return Number(limpio.replace(",", "."));
  })
  .refine((valor) => Number.isFinite(valor), { message: "Debe ser un número válido." })
  .refine((valor) => valor < TAMANO_MM_MIN || valor > TAMANO_MM_MAX || medidaMmValida(valor), { message: "Use como máximo un decimal." })
  .refine((valor) => valor >= TAMANO_MM_MIN && valor <= TAMANO_MM_MAX, { message: `Debe estar entre ${TAMANO_MM_MIN} y ${TAMANO_MM_MAX} mm.` });
