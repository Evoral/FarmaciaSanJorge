/**
 * Existencia inicial / relevamiento inicial (docs/specs/existencia-inicial.md,
 * migration 0100). Pure: the window itself is computed in SQL
 * (`fsj.relevamiento_inicial_abierto`, the same function INV-S24 uses), so the
 * app and the DB can never disagree on it; this file holds what the UI and the
 * close use case decide on top of it.
 */
import { dec } from "@/shared/decimal";

/** `dias_relevamiento_inicial` default -- same fallback as `fsj.relevamiento_inicial_fecha_limite`. */
export const DIAS_RELEVAMIENTO_INICIAL_DEFAULT = "30";

/** Ceiling of `dias_relevamiento_inicial` (three months): existencia inicial is an onboarding door, not a standing one. Same cap in `fsj.relevamiento_inicial_fecha_limite`. */
export const DIAS_RELEVAMIENTO_INICIAL_MAX = 90;

export const MENSAJE_RELEVAMIENTO_CERRADO =
  "El relevamiento inicial está cerrado: ya no se puede cargar existencia inicial. Una diferencia de stock se corrige con un ajuste por diferencia de arqueo.";

export interface EstadoRelevamientoInicial {
  abierto: boolean;
  /** When the DT closed it, `null` when it was not closed by the DT (still open, or past its plazo). */
  cerradoEn: Date | null;
  cerradoPor: string | null;
  /** Last jornada of the plazo (YYYY-MM-DD), `null` while no cierre diario is signed. */
  fechaLimite: string | null;
}

/** One controlled droga at the close: its contralor saldo against its physical stock (spec R8). */
export interface SaldoControlada {
  drogaId: string;
  drogaNombre: string;
  unidadSimbolo: string;
  /** Latest vigente asiento's `saldo_posterior` in its open libro; `null` = no APERTURA yet. */
  saldoContralor: string | null;
  /** Sum of `cantidad_disponible` of all its partidas. */
  stockFisico: string;
}

/** The controlled drogas whose contralor saldo (no APERTURA = 0) differs from their physical stock. */
export function diferenciasControladas(saldos: readonly SaldoControlada[]): SaldoControlada[] {
  return saldos.filter((s) => !dec(s.saldoContralor ?? "0").equals(dec(s.stockFisico)));
}
