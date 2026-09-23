/**
 * Pure domain types/rules for the stock module (M07, FASE 5). The DB is
 * authoritative for every INV-S/INV-STK invariant (migrations 0008/0014) --
 * everything here is either a fast pre-DB check for a clear Spanish message
 * (same convention as modules/drogas/domain/droga.ts), or a value shared by
 * more than one application/*.ts file so it stays defined once.
 */
import { z } from "zod";
import { Decimal } from "decimal.js";

// ============================================================================
// motivo_ajuste (5.4, DP-21b: every AJUSTE subtracts)
// ============================================================================
export const MOTIVOS_AJUSTE = ["ROTURA", "DERRAME", "VENCIMIENTO", "PREPARACION_DESCARTADA", "DIFERENCIA_ARQUEO"] as const;
export type MotivoAjuste = (typeof MOTIVOS_AJUSTE)[number];

const MOTIVOS_AJUSTE_SET: ReadonlySet<string> = new Set(MOTIVOS_AJUSTE);
export function esMotivoAjuste(value: string): value is MotivoAjuste {
  return MOTIVOS_AJUSTE_SET.has(value);
}

/** Neutral, professional Spanish -- UI copy. */
export const MOTIVO_AJUSTE_LABELS: Record<MotivoAjuste, string> = {
  ROTURA: "Rotura",
  DERRAME: "Derrame",
  VENCIMIENTO: "Vencimiento",
  PREPARACION_DESCARTADA: "Preparación descartada",
  DIFERENCIA_ARQUEO: "Diferencia de arqueo",
};

// ============================================================================
// Validation primitives
// ============================================================================

/** Mirrors `shared/validation`'s `positiveDecimalString` (not re-exported from there -- kept local, same rationale as droga's `nonNegativeDecimalString`). */
export const positiveDecimalString = z
  .string()
  .trim()
  .min(1, "This field cannot be empty.")
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Must be a valid decimal number." });
      return z.NEVER;
    }
    if (!parsed.isFinite() || !parsed.greaterThan(0)) {
      ctx.addIssue({ code: "custom", message: "Must be greater than zero." });
      return z.NEVER;
    }
    return parsed;
  });

/** `partida.costo_unitario >= 0` (migration 0008's `partida_costo_check`). */
export const nonNegativeDecimalString = z
  .string()
  .trim()
  .min(1, "This field cannot be empty.")
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Must be a valid decimal number." });
      return z.NEVER;
    }
    if (!parsed.isFinite() || parsed.isNegative()) {
      ctx.addIssue({ code: "custom", message: "Must be zero or greater." });
      return z.NEVER;
    }
    return parsed;
  });

/** `YYYY-MM-DD`, matching migration 0008's `fecha_vencimiento date`. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date in YYYY-MM-DD format.");

/**
 * Ingreso de partida (5.1): `fecha_vencimiento` must be STRICTLY in the
 * future, relative to the tenant's jornada -- not the DB's own CHECK (there
 * isn't one; migration 0008's header explicitly leaves "vencimiento futuro"
 * as an [APP] concern, mirroring INV-S10's own [APP]-primary/DB-reinforcement
 * split). `jornadaActual` must come from `fsj.jornada_actual(tenantId)`
 * (server-derived), never `new Date()` client-side.
 */
export function esFechaVencimientoFutura(fechaVencimiento: string, jornadaActual: string): boolean {
  return fechaVencimiento > jornadaActual;
}

/**
 * Ajustes (5.4, DP-21b): the quantity to subtract may not exceed the
 * partida's CURRENT available balance -- the DB's own CHECK
 * (`cantidad_disponible >= 0`) enforces this too, but this pure check lets
 * `registrar-ajuste.ts` return a clear Spanish message BEFORE attempting
 * the write (same "fast pre-DB check" convention as the rest of this file).
 */
export function ajusteExcedeSaldo(cantidadAjuste: Decimal, cantidadDisponible: Decimal): boolean {
  return cantidadAjuste.greaterThan(cantidadDisponible);
}

/**
 * FASE 5 point 5.7 (alertas de vencimiento): default number of days ahead
 * of the tenant's jornada that counts as "próxima a vencer", used ONLY as a
 * fallback when the tenant has no `dias_alerta_vencimiento_partida`
 * `parametro` row yet (see modules/stock/infrastructure/partida-repository.ts's
 * `getDiasAlertaVencimiento`). Kept in sync by hand with
 * modules/parametros/domain/parametros-registry.ts's `valorPorDefecto` for
 * the same clave -- modules/stock cannot import modules/parametros'
 * infrastructure layer (module boundary, see
 * modules/usuarios/infrastructure/admin-guard.ts's header comment), so this
 * is a documented, deliberate duplication of one literal, not a drifted
 * copy of logic.
 */
export const DIAS_ALERTA_VENCIMIENTO_PARTIDA_DEFAULT = "30";
