/**
 * Calendar dates for display, as dd/mm/aaaa (es-AR). Pure, no I/O.
 *
 * - A Postgres `date` (e.g. fecha de prescripción) arrives as UTC midnight:
 *   format it in UTC, never in the server's zone (it would shift a day).
 * - A `timestamptz` (e.g. fecha de ingreso) is shown as the farmacia's own
 *   calendar day: pass the tenant's `zona_horaria`.
 */
export function formatFecha(fecha: Date, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(fecha);
}

/**
 * A calendar day already given as `YYYY-MM-DD` (a jornada, a filter value) as dd/mm/aaaa. Anything that is not in
 * that shape is returned unchanged, so a display never throws on unexpected input.
 */
export function formatFechaIso(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** An instant as dd/mm/aaaa hh:mm (24 h), in the farmacia's zona horaria. */
export function formatFechaHora(fecha: Date, timeZone: string): string {
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")}/${parte("month")}/${parte("year")} ${parte("hour")}:${parte("minute")}`;
}
