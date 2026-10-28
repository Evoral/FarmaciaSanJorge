/**
 * Vencimiento del preparado (DP-28 "Vencimiento", resolved 2026-10-07): a
 * preparado expires N calendar months after its elaboración, N being the
 * per-tenant parameter `meses_vencimiento_preparado` (default 3). The date is
 * SNAPSHOTTED on `preparacion.fecha_vencimiento` when the preparación is
 * confirmed, so changing the parameter later never moves an existing date.
 *
 * Pure, no I/O and no JS `Date`: dates travel as `YYYY-MM-DD` strings (the
 * tenant-local jornada, `fsj.jornada_actual`) and the arithmetic is plain
 * integers, so nothing here depends on the server's timezone.
 */

/** Same default scripts/create-tenant.ts and migration 0068 seed; the fallback when a tenant has no usable row. */
export const MESES_VENCIMIENTO_PREPARADO_DEFAULT = 3;

/**
 * Upper bound of the parameter (5 years). Enforced by the admin validator
 * (modules/parametros/domain/parametros-registry.ts) and again when reading
 * the row, so a value written outside the app can never push the computed
 * date out of Postgres' `date` range and break every confirmation.
 */
export const MESES_VENCIMIENTO_PREPARADO_MAX = 60;

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** Days in `mes` (1-12) of `anio`. */
function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `fechaElaboracion` + `meses` calendar months, keeping the day of the month
 * and clamping to the last day of the target month when it is shorter:
 * 2026-01-31 + 1 -> 2026-02-28, 2027-11-29 + 3 -> 2028-02-29.
 * Throws on a malformed or impossible date, or on `meses` that is not an
 * integer >= 1 (the parameter's own rule).
 */
export function calcularVencimientoPreparado(fechaElaboracion: string, meses: number): string {
  const match = FECHA_ISO.exec(fechaElaboracion);
  if (!match) throw new RangeError(`Fecha de elaboración inválida: "${fechaElaboracion}" (se esperaba YYYY-MM-DD).`);
  const anio = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) {
    throw new RangeError(`Fecha de elaboración inválida: "${fechaElaboracion}".`);
  }
  if (!Number.isInteger(meses) || meses < 1) {
    throw new RangeError(`Los meses de vencimiento deben ser un entero mayor o igual que 1 (recibido: ${meses}).`);
  }

  const mesesTotales = anio * 12 + (mes - 1) + meses;
  const anioDestino = Math.floor(mesesTotales / 12);
  const mesDestino = (mesesTotales % 12) + 1;
  const diaDestino = Math.min(dia, diasDelMes(anioDestino, mesDestino));
  return `${String(anioDestino).padStart(4, "0")}-${dosDigitos(mesDestino)}-${dosDigitos(diaDestino)}`;
}

/**
 * Tipo de vencimiento (openspec/specs/vencimiento-preparado/spec.md R9-R14, migration 0096): chosen per ítem when confirming.
 * `ESTANDAR` is the parameter's months; the aqueous tipos are regulatory day limits for preparados without a
 * monograph -- constants, never tenant parameters, so a farmacia cannot lengthen them.
 */
export const TIPOS_VENCIMIENTO_PREPARADO = ["ESTANDAR", "ACUOSA_CON_CONSERVANTE", "ACUOSA_SIN_CONSERVANTE"] as const;

export type TipoVencimientoPreparado = (typeof TIPOS_VENCIMIENTO_PREPARADO)[number];

export const TIPO_VENCIMIENTO_DEFAULT: TipoVencimientoPreparado = "ESTANDAR";

export const DIAS_POR_TIPO_VENCIMIENTO: Readonly<Record<Exclude<TipoVencimientoPreparado, "ESTANDAR">, number>> = {
  ACUOSA_CON_CONSERVANTE: 35,
  ACUOSA_SIN_CONSERVANTE: 14,
};

/** The selector's option text; `ESTANDAR` shows the tenant's months. */
export function etiquetaTipoVencimiento(tipo: TipoVencimientoPreparado, mesesEstandar: number): string {
  if (tipo === "ESTANDAR") return `Estándar (${mesesEstandar} ${mesesEstandar === 1 ? "mes" : "meses"})`;
  const dias = DIAS_POR_TIPO_VENCIMIENTO[tipo];
  return tipo === "ACUOSA_CON_CONSERVANTE" ? `Acuosa con conservantes (${dias} días)` : `Acuosa sin conservantes (${dias} días)`;
}

/** Whether the tipo is counted in days: its etiqueta prints the day (R12). `null` = confirmed before 0096. */
export function esTipoVencimientoEnDias(tipo: TipoVencimientoPreparado | null): boolean {
  return tipo !== null && tipo !== "ESTANDAR";
}

/** `fechaElaboracion` + `dias` calendar days (integer >= 1), same integer arithmetic as the months version. */
export function sumarDias(fechaElaboracion: string, dias: number): string {
  const match = FECHA_ISO.exec(fechaElaboracion);
  if (!match) throw new RangeError(`Fecha de elaboración inválida: "${fechaElaboracion}" (se esperaba YYYY-MM-DD).`);
  let anio = Number(match[1]);
  let mes = Number(match[2]);
  let dia = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) {
    throw new RangeError(`Fecha de elaboración inválida: "${fechaElaboracion}".`);
  }
  if (!Number.isInteger(dias) || dias < 1) {
    throw new RangeError(`Los días de vencimiento deben ser un entero mayor o igual que 1 (recibido: ${dias}).`);
  }

  dia += dias;
  while (dia > diasDelMes(anio, mes)) {
    dia -= diasDelMes(anio, mes);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }
  return `${String(anio).padStart(4, "0")}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

/** R1/R9: the preparado's expiry for the chosen tipo; `mesesEstandar` is the tenant's `meses_vencimiento_preparado`. */
export function calcularVencimientoPorTipo(fechaElaboracion: string, tipo: TipoVencimientoPreparado, mesesEstandar: number): string {
  return tipo === "ESTANDAR" ? calcularVencimientoPreparado(fechaElaboracion, mesesEstandar) : sumarDias(fechaElaboracion, DIAS_POR_TIPO_VENCIMIENTO[tipo]);
}

/**
 * Parses the raw `fsj.parametro.valor` of `meses_vencimiento_preparado`: a
 * an integer in [1, MESES_VENCIMIENTO_PREPARADO_MAX], else (no row, empty, non-numeric, out of range, fractional)
 * `MESES_VENCIMIENTO_PREPARADO_DEFAULT` -- the same defensive fallback every
 * other `fsj.parametro` reader has.
 */
export function parseMesesVencimientoPreparado(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return MESES_VENCIMIENTO_PREPARADO_DEFAULT;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return MESES_VENCIMIENTO_PREPARADO_DEFAULT;
  const meses = Number(trimmed);
  return Number.isSafeInteger(meses) && meses >= 1 && meses <= MESES_VENCIMIENTO_PREPARADO_MAX ? meses : MESES_VENCIMIENTO_PREPARADO_DEFAULT;
}
