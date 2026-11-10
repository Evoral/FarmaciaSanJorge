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

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` for a real calendar date in `YYYY-MM-DD` form (rejects e.g. `2026-02-30`). */
export function esFechaIso(value: string): boolean {
  const match = FECHA_ISO.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * A `YYYY-MM-DD` date that exists in the calendar. Output stays the string, so queries that cast `${x}::date`
 * keep working. The one date validator for forms and use case inputs (spec fechas-entrada FE1).
 */
export const fechaIso = z
  .string()
  .trim()
  // `abort`: a malformed value gets the shape message only, not the calendar one too.
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Debe ser una fecha en formato AAAA-MM-DD.", abort: true })
  .refine(esFechaIso, "Debe ser una fecha que exista en el calendario.");

/** For pages reading a date from `searchParams`: the date when valid, else `undefined` (filter ignored, FE2). */
export function filtroFechaIso(value: string | undefined): string | undefined {
  return value !== undefined && esFechaIso(value) ? value : undefined;
}

/** Optional free text: trimmed; "", null and undefined all become null. */
export function textoOpcional(max?: number) {
  const texto = max === undefined ? z.string().trim() : z.string().trim().max(max);
  return texto.nullish().transform((value) => value || null);
}

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


/** `decimalString` restricted to values >= 0. */
export const nonNegativeDecimalString = decimalString.refine((value) => !value.isNegative(), {
  message: "Debe ser cero o mayor.",
});
