/**
 * Expiry of a partida and its reanálisis (docs/specs/reanalisis-partida.md,
 * migration 0074). Pure: no I/O, plain `YYYY-MM-DD` strings (lexically
 * comparable), the jornada always from `fsj.jornada_actual(tenant)`.
 *
 * Every expiry decision uses the vencimiento VIGENTE
 * (`partida.fecha_vencimiento_vigente`: the latest reanálisis' date, else the
 * original `fecha_vencimiento`), never the original date. The DB is
 * authoritative (INV-S10 / INV-S22 / INV-S23); these are the same rules, for
 * clear Spanish messages and for the UI.
 */
import { z } from "zod";
import { isoDate } from "./partida";

export type EstadoVencimientoPartida = "NO_VENCE" | "VIGENTE" | "POR_VENCER" | "VENCIDA";

/** `iso` + `dias` calendar days, as `YYYY-MM-DD` (UTC arithmetic on a calendar day: no time zone involved). */
export function sumarDias(iso: string, dias: number): string {
  const fecha = new Date(`${iso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * VENCIDA: vigente < jornada (INV-S10, the same predicate as `estaVencida`). POR_VENCER: jornada <= vigente <=
 * jornada + `diasAlerta` (both ends included -- the window of `alertasPorVencer`). NO_VENCE: no date (an insumo).
 */
export function estadoVencimientoPartida(fechaVencimientoVigente: string | null, jornadaActual: string, diasAlerta: number): EstadoVencimientoPartida {
  if (fechaVencimientoVigente === null) return "NO_VENCE";
  if (fechaVencimientoVigente < jornadaActual) return "VENCIDA";
  if (fechaVencimientoVigente <= sumarDias(jornadaActual, diasAlerta)) return "POR_VENCER";
  return "VIGENTE";
}

/** Whole calendar days from `jornadaActual` to `fechaVencimientoVigente` (0 = vence hoy, negative = vencida). */
export function diasHastaVencimiento(fechaVencimientoVigente: string, jornadaActual: string): number {
  const ms = Date.parse(`${fechaVencimientoVigente}T00:00:00Z`) - Date.parse(`${jornadaActual}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "Vence hoy" / "Vence mañana" / "Vence en N días" -- compact copy for a POR_VENCER badge. */
export function textoPorVencer(fechaVencimientoVigente: string, jornadaActual: string): string {
  const dias = diasHastaVencimiento(fechaVencimientoVigente, jornadaActual);
  if (dias <= 0) return "Vence hoy";
  if (dias === 1) return "Vence mañana";
  return `Vence en ${dias} días`;
}

/** UI copy for a vencida partida that blocks stock until the DT acts. */
export const MENSAJE_VENCIDA_REQUIERE_DT = "Vencida: requiere acción del DT (reanálisis o marcar como vencida).";

// ============================================================================
// Reanálisis (INV-S22) and "marcar como vencida"
// ============================================================================

/** What the rules need to know about the partida (read AFTER its lock). */
export interface PartidaParaVencimiento {
  /** `droga.clase` (migration 0063). */
  drogaClase: string;
  /** `cantidad_disponible` > 0 -- a partida with saldo 0 is terminal (it can never regain stock, DP-21b). */
  tieneSaldo: boolean;
  /** `YYYY-MM-DD`, `null` = does not expire. */
  fechaVencimientoVigente: string | null;
}

export type RechazoReanalisis = "NO_ES_DROGA" | "SIN_SALDO" | "FECHA_NO_FUTURA";

/**
 * A reanálisis needs a DROGA partida (insumos keep their date), with saldo (saldo 0 = terminal: marked as vencida or
 * fully consumed), and a new date strictly after the jornada. No limit on how far or how many times: the analysis
 * decides. Allowed whether the partida is vencida, por vencer or still vigente.
 */
export function rechazoReanalisis(partida: PartidaParaVencimiento, fechaReanalisis: string, jornadaActual: string): RechazoReanalisis | null {
  if (partida.drogaClase !== "DROGA" || partida.fechaVencimientoVigente === null) return "NO_ES_DROGA";
  if (!partida.tieneSaldo) return "SIN_SALDO";
  if (fechaReanalisis <= jornadaActual) return "FECHA_NO_FUTURA";
  return null;
}

export const MENSAJES_RECHAZO_REANALISIS: Record<RechazoReanalisis, string> = {
  NO_ES_DROGA: "Solo se puede registrar un reanálisis en una partida de droga; los excipientes y materiales conservan su vencimiento.",
  SIN_SALDO: "La partida no tiene saldo: ya fue marcada como vencida o se consumió por completo, y no admite reanálisis.",
  FECHA_NO_FUTURA: "La fecha de reanálisis debe ser posterior a la fecha actual.",
};

export type RechazoMarcarVencida = "NO_ES_DROGA" | "SIN_SALDO" | "NO_VENCIDA";

/**
 * "Marcar como vencida": only a DROGA partida whose vencimiento vigente already passed and that still has saldo. It
 * discounts the whole saldo (AJUSTE VENCIMIENTO); the partida is then terminal (saldo 0). A por vencer partida is not
 * marked: it waits for its date or gets a reanálisis.
 */
export function rechazoMarcarVencida(partida: PartidaParaVencimiento, jornadaActual: string): RechazoMarcarVencida | null {
  if (partida.drogaClase !== "DROGA" || partida.fechaVencimientoVigente === null) return "NO_ES_DROGA";
  if (!partida.tieneSaldo) return "SIN_SALDO";
  if (!(partida.fechaVencimientoVigente < jornadaActual)) return "NO_VENCIDA";
  return null;
}

export const MENSAJES_RECHAZO_MARCAR_VENCIDA: Record<RechazoMarcarVencida, string> = {
  NO_ES_DROGA: "Solo se marca como vencida una partida de droga; para un excipiente o material registrá un ajuste por vencimiento.",
  SIN_SALDO: "La partida ya no tiene saldo para descontar.",
  NO_VENCIDA: "La partida todavía no está vencida.",
};

/** Default observación of the VENCIMIENTO ajuste "marcar como vencida" registers. */
export const OBSERVACION_MARCAR_VENCIDA = "Partida vencida: el Director Técnico la marcó como vencida y se descontó todo su saldo.";

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Como máximo ${max} caracteres.`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Reanálisis fields (the DT's password travels apart, never through this schema). */
export const reanalisisCampos = z.object({
  fechaReanalisis: isoDate,
  motivo: textoOpcional(500),
  respaldo: textoOpcional(200),
});

export const marcarVencidaCampos = z.object({
  observacion: textoOpcional(500),
});
