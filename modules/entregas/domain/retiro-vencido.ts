/**
 * Retiro vencido (openspec/specs/retiro-vencido/spec.md): a PREPARADA receta that nobody picks up moves, after N days, to
 * RETIRO_VENCIDO. N is the per-tenant parameter `dias_retiro_vencido` (default 30, 0 = disabled, RV1/RV10).
 *
 * Pure, no I/O. This file holds the parameter's bounds and its defensive parser, and the date arithmetic of the daily job
 * (RV1): which PREPARADA recetas have waited long enough.
 */
import { ValidationError } from "@/shared/errors";
import { inicioDeJornada, jornadaDe } from "@/shared/time/jornada";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";

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

/** `YYYY-MM-DD` shifted by a whole number of calendar days (negative = earlier). Pure calendar arithmetic, no time zone involved. */
export function sumarDiasAJornada(jornada: string, dias: number): string {
  const [year, month, day] = jornada.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + dias)).toISOString().slice(0, 10);
}

/**
 * RV1, as a cutoff for the job's query: a PREPARADA receta is vencida iff `preparada_en < cutoff`.
 *
 * "N jornadas" are counted in calendar days of the tenant's zone, not in 24-hour blocks: a receta prepared on jornada D
 * expires on the first run on jornada >= D + N, whatever the hour it was prepared. So today's jornada J expires every
 * receta prepared on a jornada <= J - N, i.e. every instant before the start of jornada J - N + 1 (local midnight, in
 * the tenant's zone). `null` when N = 0 (disabled: nothing ever expires, RV1).
 *
 * `jornadaActual` is the tenant's current jornada as the DB reports it (`fsj.jornada_actual`), so the job and every
 * other "today" in the app read the same clock.
 */
export function instanteCorteRetiroVencido(jornadaActual: string, dias: number, zonaHoraria: string): Date | null {
  if (retiroVencidoDesactivado(dias)) return null;
  return inicioDeJornada(sumarDiasAJornada(jornadaActual, 1 - dias), zonaHoraria);
}

/**
 * RV1 for a single receta: has its retiro expired at `ahora`? Same rule as {@link instanteCorteRetiroVencido}, expressed on
 * jornadas (`jornada(preparadaEn) + N <= jornada(ahora)`). A receta with no `preparadaEn` (it should not exist in
 * PREPARADA: the trigger of migration 0095 always sets it) never expires: without the reference date there is nothing to
 * count from.
 */
export function esRetiroVencido(input: { preparadaEn: Date | null; dias: number; ahora: Date; zonaHoraria: string }): boolean {
  if (input.preparadaEn === null || retiroVencidoDesactivado(input.dias)) return false;
  const jornadaPreparada = jornadaDe(input.preparadaEn, input.zonaHoraria);
  const jornadaActual = jornadaDe(input.ahora, input.zonaHoraria);
  return sumarDiasAJornada(jornadaPreparada, input.dias) <= jornadaActual;
}

/**
 * The jornada (YYYY-MM-DD) on which a receta's retiro expires: `jornada(preparadaEn) + N`, the same day the job moves it
 * to RETIRO_VENCIDO (RV1). What the entrega pop-up shows as "venció el ...". `null` when there is nothing to count from
 * (no `preparadaEn`) or the parameter is 0 (disabled, so there is no plazo to name).
 */
export function jornadaVencimientoRetiro(input: { preparadaEn: Date | null; dias: number; zonaHoraria: string }): string | null {
  if (input.preparadaEn === null || retiroVencidoDesactivado(input.dias)) return null;
  return sumarDiasAJornada(jornadaDe(input.preparadaEn, input.zonaHoraria), input.dias);
}

// ============================================================================
// Reactivar (RV4-RV6).
// ============================================================================

export const MENSAJE_REACTIVAR_NO_VENCIDA = "La receta no está en retiro vencido.";
export const MENSAJE_REACTIVAR_ARCHIVADA = "La receta ya está archivada: no se puede reactivar.";
export const MENSAJE_REACTIVAR_REQUIERE_CO_FIRMA =
  "Hay preparados vencidos: para reactivar la receta hace falta la co-firma del Director Técnico.";

/** RV4: only a RETIRO_VENCIDO receta that is not in a lote de archivo goes back to PREPARADA. */
export function puedeReactivar(input: { estado: EstadoReceta; loteArchivoId: string | null }): boolean {
  return input.estado === "RETIRO_VENCIDO" && input.loteArchivoId === null;
}

/** The same rule as {@link puedeReactivar}, with the message of whichever condition fails (RV4). */
export function validarReactivar(input: { estado: EstadoReceta; loteArchivoId: string | null }): void {
  if (input.estado !== "RETIRO_VENCIDO") throw new ValidationError(MENSAJE_REACTIVAR_NO_VENCIDA);
  if (input.loteArchivoId !== null) throw new ValidationError(MENSAJE_REACTIVAR_ARCHIVADA);
}

/** One confirmed preparación of the receta, as the reactivation needs it. `fechaVencimiento` is `YYYY-MM-DD`, null for data confirmed before migration 0068. */
export interface PreparadoConVencimiento {
  /** The ítem's description, or its forma farmacéutica when it has none. */
  etiqueta: string;
  fechaVencimiento: string | null;
}

export interface PreparadoVencido {
  etiqueta: string;
  /** `YYYY-MM-DD` */
  fechaVencimiento: string;
}

/**
 * RV5: the preparados whose `fecha_vencimiento` is before the tenant's jornada actual (a preparado that expires today is
 * still good today). One without a `fecha_vencimiento` (confirmed before 0068) is not considered vencido. Keeps the input order.
 */
export function preparadosVencidos(preparaciones: readonly PreparadoConVencimiento[], jornadaActual: string): PreparadoVencido[] {
  const vencidos: PreparadoVencido[] = [];
  for (const preparado of preparaciones) {
    if (preparado.fechaVencimiento !== null && preparado.fechaVencimiento < jornadaActual) {
      vencidos.push({ etiqueta: preparado.etiqueta, fechaVencimiento: preparado.fechaVencimiento });
    }
  }
  return vencidos;
}

/** Which of the co-firma's two fields the form left empty (the ones to mark). Both present = none missing. */
export function camposFaltantesCoFirma(input: { dtUsuarioId?: string | undefined; dtPassword?: string | undefined }): string[] {
  const faltantes: string[] = [];
  if (!input.dtUsuarioId) faltantes.push("dtUsuarioId");
  if (!input.dtPassword) faltantes.push("dtPassword");
  return faltantes;
}
