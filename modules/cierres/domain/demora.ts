/**
 * Pure date-arithmetic helpers for M13a (FASE 10, points 10.1/10.3/10.4).
 * No I/O -- every date here is a plain `YYYY-MM-DD` string (the same shape
 * `fsj.jornada_actual()` / `fecha_asiento` / `cierre_diario.fecha` use), so
 * these mirror the DB's own logic (`fsj.cierre_diario_calcular_fuera_de_termino`,
 * migration 0038) without touching a database -- used by the UI (pending
 * list ordering, the "va a quedar fuera de término" hint before submit) and
 * by the compliance report (`demoraDias`).
 *
 * Implemented with `Date.UTC` only (no extra date library, per plan §8) --
 * every `YYYY-MM-DD` string is parsed as a UTC calendar date, so this is
 * immune to the local time zone of whatever machine runs it.
 */

const FECHA_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(fechaIso: string): { y: number; m: number; d: number } {
  const match = FECHA_ISO_PATTERN.exec(fechaIso);
  if (!match) throw new TypeError(`Expected a YYYY-MM-DD date, got: ${fechaIso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** `fechaIso` plus `dias` calendar days (may be negative), as `YYYY-MM-DD`. */
export function addDiasIso(fechaIso: string, dias: number): string {
  const { y, m, d } = parseIsoDate(fechaIso);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

/** Whole calendar days between two `YYYY-MM-DD` dates (`hasta - desde`). Negative when `hasta` is earlier. */
export function diasEntreIso(desdeIso: string, hastaIso: string): number {
  const desde = parseIsoDate(desdeIso);
  const hasta = parseIsoDate(hastaIso);
  const msPerDay = 24 * 60 * 60 * 1000;
  const desdeMs = Date.UTC(desde.y, desde.m - 1, desde.d);
  const hastaMs = Date.UTC(hasta.y, hasta.m - 1, hasta.d);
  return Math.round((hastaMs - desdeMs) / msPerDay);
}

export interface FueraDeTerminoInput {
  /** `fsj.jornada_actual(tenant)`, the tenant's CURRENT business day. */
  jornadaActual: string;
  /** The jornada being (or that was) signed. */
  fecha: string;
  /** `plazo_firma_dias` parameter (DP-18 RESUELTA) -- 0 means "only the same jornada is on time". */
  plazoFirmaDias: number;
}

/**
 * Mirrors `fsj.cierre_diario_calcular_fuera_de_termino` (migration 0038)
 * exactly -- used ONLY for UI hints (e.g. "esta firma va a quedar fuera de
 * término") before the form is submitted. The DB function remains the
 * single source of truth for what `cierre_diario.fuera_de_termino` actually
 * ends up being; this is never used to skip asking the server.
 */
export function calcularFueraDeTermino(input: FueraDeTerminoInput): boolean {
  return input.jornadaActual > addDiasIso(input.fecha, input.plazoFirmaDias);
}

/** Days of "antigüedad" for a pending jornada -- how many days ago `fecha` was, relative to the tenant's current jornada. Never negative for a jornada that is not in the future. */
export function calcularAntiguedadDias(fecha: string, jornadaActual: string): number {
  return diasEntreIso(fecha, jornadaActual);
}

/** Demora (in days) between the jornada's own date and the jornada the signature actually landed on -- used by the compliance report (FASE 10 point 10.4). Zero or negative means on time or early. */
export function calcularDemoraDias(fecha: string, jornadaFirma: string): number {
  return diasEntreIso(fecha, jornadaFirma);
}
