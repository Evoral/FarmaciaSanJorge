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

/** Milliseconds `timeZone`'s wall clock is ahead of UTC at `instant` (negative west of Greenwich, e.g. -3h for Mendoza). */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const wallClockAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * First instant of `jornada` (YYYY-MM-DD) in `timeZone` -- i.e. local
 * midnight, as an absolute `Date`. Inverse of `jornadaDe` at day
 * boundaries: `jornadaDe(inicioDeJornada(j)) === j`. Use it to turn a
 * user-picked calendar date into a timestamp range filter; never compare a
 * `timestamptz` against `new Date("YYYY-MM-DD")`, which is UTC midnight
 * (3 hours off in Mendoza).
 */
export function inicioDeJornada(jornada: string, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const [year, month, day] = jornada.split("-").map(Number);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  // Two passes: the offset is looked up at the first estimate, then again at the corrected instant (handles DST-changing zones).
  const firstGuess = midnightAsUtc - offsetMs(midnightAsUtc, timeZone);
  return new Date(midnightAsUtc - offsetMs(firstGuess, timeZone));
}

/**
 * Half-open instant range `[desde, hasta)` covering the WHOLE of each given
 * jornada (both ends inclusive as calendar days): `desde` = start of
 * `jornadaDesde`, `hastaExclusivo` = start of the day AFTER `jornadaHasta`.
 */
export function rangoDeJornadas(
  jornadaDesde: string | undefined,
  jornadaHasta: string | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): { desde?: Date; hastaExclusivo?: Date } {
  let hastaExclusivo: Date | undefined;
  if (jornadaHasta) {
    const [year, month, day] = jornadaHasta.split("-").map(Number);
    const siguiente = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    hastaExclusivo = inicioDeJornada(siguiente, timeZone);
  }
  return { desde: jornadaDesde ? inicioDeJornada(jornadaDesde, timeZone) : undefined, hastaExclusivo };
}
