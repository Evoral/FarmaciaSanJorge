/**
 * `jornada` (business day) computation. A jornada is the calendar date, in
 * the pharmacy's local time zone, that a given instant belongs to -- used
 * for daily closing (M13) and the legal recipe ledger (M12). Always derive
 * it from a server/DB timestamp, never from client-supplied dates
 * (INV-PL-002).
 *
 * Implemented with `Intl.DateTimeFormat` only (no extra date library) per
 * plan §8.
 */

const DEFAULT_TIME_ZONE = "America/Argentina/Mendoza";

/**
 * Returns the jornada (YYYY-MM-DD) that `instant` belongs to in `timeZone`.
 */
export function jornadaDe(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD directly.
  return formatter.format(instant);
}
