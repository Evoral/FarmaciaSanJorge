/**
 * `/stock/ajustes` list filters (pure, no I/O): parsing of the page's GET
 * params into the normalized filters the query takes, and back into the
 * query string its pagination links carry. Anything invalid is dropped
 * (treated as "no filter") instead of failing the page, same as every other
 * list page in this app.
 */
import { esMotivoAjuste, type MotivoAjuste } from "./partida";

export interface FiltrosAjustes {
  q?: string;
  motivo?: MotivoAjuste;
  /** YYYY-MM-DD jornada, inclusive. */
  desde?: string;
  /** YYYY-MM-DD jornada, inclusive. */
  hasta?: string;
}

export type ParamsAjustes = Partial<Record<"q" | "motivo" | "desde" | "hasta", string>>;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` for a real calendar date in `YYYY-MM-DD` form (rejects e.g. `2026-02-30`). */
export function esFechaIso(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseFiltrosAjustes(params: ParamsAjustes): FiltrosAjustes {
  const q = params.q?.trim() || undefined;
  const motivo = params.motivo && esMotivoAjuste(params.motivo) ? params.motivo : undefined;
  const desde = params.desde && esFechaIso(params.desde) ? params.desde : undefined;
  const hasta = params.hasta && esFechaIso(params.hasta) ? params.hasta : undefined;
  return { q, motivo, desde, hasta };
}

/** An inverted range (`desde` after `hasta`); ISO dates compare correctly as strings. */
export function rangoAjustesInvalido(filtros: FiltrosAjustes): boolean {
  return Boolean(filtros.desde && filtros.hasta && filtros.desde > filtros.hasta);
}

export function hayFiltrosAjustes(filtros: FiltrosAjustes): boolean {
  return Boolean(filtros.q || filtros.motivo || filtros.desde || filtros.hasta);
}

/**
 * The normalized filters as a query string, plus `page` when given. Never
 * carries one-shot flags such as `registrado` (the success banner), so a
 * pagination link never re-shows it.
 */
export function ajustesSearchParams(filtros: FiltrosAjustes, page?: number): URLSearchParams {
  const qs = new URLSearchParams();
  if (filtros.q) qs.set("q", filtros.q);
  if (filtros.motivo) qs.set("motivo", filtros.motivo);
  if (filtros.desde) qs.set("desde", filtros.desde);
  if (filtros.hasta) qs.set("hasta", filtros.hasta);
  if (page !== undefined) qs.set("page", String(page));
  return qs;
}
