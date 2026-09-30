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
