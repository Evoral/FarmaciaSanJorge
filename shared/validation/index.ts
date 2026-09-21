/**
 * Shared zod primitives for input validation at the server edge (see the
 * use-case pattern in docs/architecture.md: requireSession -> authorize ->
 * zod.parse -> transaction -> audit). Module-specific schemas compose
 * these; they don't redefine uuid/string rules ad hoc.
 */
import { z } from "zod";
import { Decimal } from "decimal.js";

/** A non-empty, trimmed string. */
export const nonEmptyString = z
  .string()
  .trim()
  .min(1, "This field cannot be empty.");

/** A v4 UUID (Postgres `uuid` columns / `gen_random_uuid()`). */
export const uuid = z.string().uuid("Must be a valid UUID.");

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
  .email("Must be a valid email address.");

/**
 * A string that parses to a valid, finite `Decimal` -- used for quantity
 * and money input fields, which arrive as strings over the wire (never
 * `number`, to avoid float precision loss before it even reaches decimal.js).
 */
export const decimalString = z
  .string()
  .trim()
  .min(1, "This field cannot be empty.")
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Must be a valid decimal number." });
      return z.NEVER;
    }
    if (!parsed.isFinite()) {
      ctx.addIssue({ code: "custom", message: "Must be a finite decimal number." });
      return z.NEVER;
    }
    return parsed;
  });

/** `decimalString` restricted to values > 0. */
export const positiveDecimalString = decimalString.refine((value) => value.greaterThan(0), {
  message: "Must be greater than zero.",
});
