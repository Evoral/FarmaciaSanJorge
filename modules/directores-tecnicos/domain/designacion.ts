/**
 * Pure domain types/rules for Director Tecnico designations (M04, FASE 3
 * point 3.9). No I/O, no Prisma, no Next -- the DB (migration
 * 20260920120400_0005_designacion_director_tecnico +
 * 20260921100100_0021_designacion_dt_cese_retroactivo_guard) is the
 * ultimate source of truth for every INV-DT-XXX invariant; what lives here
 * is only:
 *   - the `CaracterDesignacion` union (mirrors `fsj.caracter_designacion_dt`),
 *   - a small local zod primitive for an ISO date string (`YYYY-MM-DD`,
 *     matching the `vigente_desde`/`vigente_hasta` `date` columns) --
 *     `shared/validation` has no date-string primitive yet (task
 *     instruction: add it locally here, do not edit shared/validation),
 *   - a FAST, pre-DB pre-check mirroring the DB's own
 *     `designacion_dt_vigencia_check` CHECK constraint (vigente_hasta >=
 *     vigente_desde), so a malformed cese/designation shows a clear
 *     Spanish message in the form instead of a round trip to the DB CHECK
 *     violation. This is a UX nicety, NOT a substitute for the DB
 *     constraint -- the DB still enforces it regardless of this check.
 */
import { z } from "zod";

export const CARACTERES_DESIGNACION = ["TITULAR", "SUPLENTE"] as const;
export type CaracterDesignacion = (typeof CARACTERES_DESIGNACION)[number];

/** Neutral, professional Spanish -- UI copy (same convention as modules/usuarios/domain/roles.ts's ROL_LABELS). */
export const CARACTER_LABELS: Record<CaracterDesignacion, string> = {
  TITULAR: "Titular",
  SUPLENTE: "Suplente",
};

/**
 * ISO date string `YYYY-MM-DD`, for the `date`-only `vigente_desde` /
 * `vigente_hasta` columns. Deliberately just a shape check (regex), not a
 * full calendar-validity check (e.g. rejecting 2026-02-30) -- the DB
 * column is `date` typed and will itself reject an impossible calendar
 * date at the INSERT/UPDATE boundary; duplicating full calendar validation
 * here would be dead code that can drift from Postgres's own rules.
 */
export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha con formato AAAA-MM-DD.");

/**
 * Mirrors `designacion_dt_vigencia_check` (migration 0005): when
 * `vigenteHasta` is present, it must be >= `vigenteDesde`. Both are
 * `YYYY-MM-DD` strings, which compare correctly lexicographically as
 * ISO-8601 dates. Returns a Spanish error message, or `null` when valid.
 */
export function validarRangoVigencia(vigenteDesde: string, vigenteHasta: string | null): string | null {
  if (vigenteHasta !== null && vigenteHasta < vigenteDesde) {
    return "La fecha de cese no puede ser anterior a la fecha de designación.";
  }
  return null;
}
