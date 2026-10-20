/**
 * Retiro vencido (docs/specs/retiro-vencido.md): a PREPARADA receta that nobody picks up moves, after N days, to
 * RETIRO_VENCIDO. N is the per-tenant parameter `dias_retiro_vencido` (default 30, 0 = disabled, RV1/RV10).
 *
 * Pure, no I/O. This file holds the parameter's bounds and its defensive parser; the job's date arithmetic (RV1) is added
 * next to it by the job slice.
 */

/** Same default scripts/create-tenant.ts and migration 0095 seed; the fallback when a tenant has no usable row. */
export const DIAS_RETIRO_VENCIDO_DEFAULT = 30;

/** Upper bound of the parameter (one year). Enforced by the admin validator and again when reading the row. */
export const DIAS_RETIRO_VENCIDO_MAX = 365;

/** `dias_retiro_vencido` = 0 turns the vencimiento off: no receta ever moves to RETIRO_VENCIDO (RV1). */
export function retiroVencidoDesactivado(dias: number): boolean {
  return dias === 0;
}

/**
 * Parses the raw `fsj.parametro.valor` of `dias_retiro_vencido`: a non-negative integer in
 * [0, DIAS_RETIRO_VENCIDO_MAX], else (no row, empty, non-numeric, negative, fractional, out of range)
 * `DIAS_RETIRO_VENCIDO_DEFAULT` -- the same defensive fallback every other parameter reader uses. Note that `"0"` is a
 * valid value (disabled), not a fallback case.
 */
export function parseDiasRetiroVencido(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return DIAS_RETIRO_VENCIDO_DEFAULT;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DIAS_RETIRO_VENCIDO_DEFAULT;
  const dias = Number(trimmed);
  return Number.isSafeInteger(dias) && dias >= 0 && dias <= DIAS_RETIRO_VENCIDO_MAX ? dias : DIAS_RETIRO_VENCIDO_DEFAULT;
}
