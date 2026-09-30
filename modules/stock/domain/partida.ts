/**
 * Pure domain types/rules for the stock module (M07, FASE 5). The DB is
 * authoritative for every INV-S/INV-STK invariant (migrations 0008/0014) --
 * everything here is either a fast pre-DB check for a clear Spanish message
 * (same convention as modules/drogas/domain/droga.ts), or a value shared by
 * more than one application/*.ts file so it stays defined once.
 */
import { z } from "zod";
import { Decimal } from "decimal.js";
import { CADENAS_CONVERTIBLES, UNIDADES_PRACTICAS } from "@/shared/format/cantidad";

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
  .min(1, "Este campo no puede estar vacío.")
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Debe ser un número decimal válido." });
      return z.NEVER;
    }
    if (!parsed.isFinite() || !parsed.greaterThan(0)) {
      ctx.addIssue({ code: "custom", message: "Debe ser mayor que cero." });
      return z.NEVER;
    }
    return parsed;
  });

/** `partida.costo_unitario >= 0` (migration 0008's `partida_costo_check`). */
export const nonNegativeDecimalString = z
  .string()
  .trim()
  .min(1, "Este campo no puede estar vacío.")
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = new Decimal(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Debe ser un número decimal válido." });
      return z.NEVER;
    }
    if (!parsed.isFinite() || parsed.isNegative()) {
      ctx.addIssue({ code: "custom", message: "Debe ser cero o mayor." });
      return z.NEVER;
    }
    return parsed;
  });

/** `YYYY-MM-DD`, matching migration 0008's `fecha_vencimiento date`. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha con formato AAAA-MM-DD.");

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

/** The `fsj.unidad_medida` fields the ajuste unit rule needs. */
export interface UnidadParaAjuste {
  id: string;
  codigo: string;
  tipoMagnitud: string;
  fechaBaja: Date | null;
}

export type RechazoUnidadAjuste = "BAJA" | "OTRA_MAGNITUD" | "NO_HABILITADA";

/**
 * Ajustes (5.4): the unit the quantity to subtract may be ENTERED in (the
 * server converts it to the droga's unidad base before the saldo check).
 * Allowed:
 *   - the droga's unidad base itself, always (no conversion; also the
 *     default when a caller sends no unit);
 *   - when the unidad base is convertible (`CADENAS_CONVERTIBLES`): any
 *     vigente unit of `UNIDADES_PRACTICAS` of the SAME magnitude (mg/g/kg,
 *     mL/L -- never mcg/mcL, never another magnitude).
 * A non-convertible unidad base (UNIDAD, UI, GOTA, %) allows only itself.
 * Returns `null` when allowed, else why not.
 */
export function rechazoUnidadAjuste(unidad: UnidadParaAjuste, unidadBase: UnidadParaAjuste): RechazoUnidadAjuste | null {
  if (unidad.id === unidadBase.id) return null;
  if (unidad.tipoMagnitud !== unidadBase.tipoMagnitud) return "OTRA_MAGNITUD";
  if (unidad.fechaBaja !== null) return "BAJA";
  const baseConvertible = CADENAS_CONVERTIBLES[unidadBase.tipoMagnitud]?.includes(unidadBase.codigo) ?? false;
  const practica = UNIDADES_PRACTICAS[unidadBase.tipoMagnitud]?.includes(unidad.codigo) ?? false;
  return baseConvertible && practica ? null : "NO_HABILITADA";
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

// ============================================================================
// /stock listing order (5.2)
// ============================================================================

/** `stock` compares in each magnitude's base unit (`stock_disponible * factor_a_base`); `vencimiento` = earliest expiry among partidas with balance, NULLS LAST. Ties always fall back to the droga's name. */
export const ORDENES_STOCK_DROGAS = ["nombre", "stock", "vencimiento"] as const;
export type OrdenStockDrogas = (typeof ORDENES_STOCK_DROGAS)[number];

/** Neutral, professional Spanish -- UI copy. */
export const ORDEN_STOCK_DROGAS_LABELS: Record<OrdenStockDrogas, string> = {
  nombre: "Nombre",
  stock: "Stock disponible",
  vencimiento: "Próximo vencimiento",
};
