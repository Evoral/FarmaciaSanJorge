/**
 * Shared zod primitives for input validation at the server edge (see the
 * use-case pattern in docs/architecture.md: requireSession -> authorize ->
 * zod.parse -> transaction -> audit). Module-specific schemas compose
 * these; they don't redefine uuid/string rules ad hoc.
 */
import { z } from "zod";
import { Decimal } from "decimal.js";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";

/** A non-empty, trimmed string. */
export const nonEmptyString = z
  .string()
  .trim()
  .min(1, "Este campo no puede estar vacío.");

/** A v4 UUID (Postgres `uuid` columns / `gen_random_uuid()`). */
export const uuid = z.string().uuid("Debe ser un identificador válido.");

/**
 * An email address, normalized (trimmed + lowercased) before validation --
 * `usuario.email` is `citext` (case-insensitive) and globally unique
 * (DP-40), but normalizing at the edge keeps app-level comparisons and
 * audit diffs consistent regardless of citext's own case-folding.
 */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Debe ser un email válido.");

/**
 * A string that parses to a valid, finite `Decimal` -- used for quantity
 * and money input fields, which arrive as strings over the wire (never
 * `number`, to avoid float precision loss before it even reaches decimal.js).
 * Read as the user typed it (`interpretarNumero`, shared/decimal/numero-ingresado.ts:
 * comma decimals, es-AR thousands, an ambiguous "1.500" refused).
 */
export const decimalString = z
  .string()
  .trim()
  .min(1, "Este campo no puede estar vacío.")
  .transform((value, ctx) => {
    const numero = interpretarNumero(value);
    if (!numero.ok) {
      ctx.addIssue({ code: "custom", message: numero.mensaje });
      return z.NEVER;
    }
    const parsed = new Decimal(numero.valor);
    if (!parsed.isFinite()) {
      ctx.addIssue({ code: "custom", message: "Debe ser un número decimal finito." });
      return z.NEVER;
    }
    return parsed;
  });

/** `decimalString` restricted to values > 0. */
export const positiveDecimalString = decimalString.refine((value) => value.greaterThan(0), {
  message: "Debe ser mayor que cero.",
});
