/**
 * A lot's vencimiento (a partida bought, counted or elaborated): suppliers print month and year only ("03/2027"),
 * so the app keeps month precision. It is stored in the existing `date` columns as that month's LAST day: the lot
 * can be used through the whole month. Every input normalizes through `finDeMes`; every display uses
 * `formatVencimientoLote` (shared/format/fecha.ts). Pure, no I/O.
 *
 * Not for a preparado's vencimiento (days after elaboration): that one keeps the day.
 */

const MES_ISO = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

/** `YYYY-MM` or `YYYY-MM-DD` -> the last day of that month as `YYYY-MM-DD`. Anything else is returned unchanged. */
export function finDeMes(iso: string): string {
  const match = MES_ISO.exec(iso.trim());
  if (!match) return iso;
  const anio = Number(match[1]);
  const mes = Number(match[2]);
  if (mes < 1 || mes > 12) return iso;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(ultimo).padStart(2, "0")}`;
}

/** A `date` column value (UTC midnight) moved to the last day of its month. */
export function fechaFinDeMes(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0));
}
