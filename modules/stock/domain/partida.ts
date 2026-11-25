/**
 * Pure domain types/rules for the stock module (M07, FASE 5). The DB is
 * authoritative for every INV-S/INV-STK invariant (migrations 0008/0014) --
 * everything here is either a fast pre-DB check for a clear Spanish message
 * (same convention as modules/drogas/domain/droga.ts), or a value shared by
 * more than one application/*.ts file so it stays defined once.
 */
import { z } from "zod";
import { Decimal } from "decimal.js";
import { DomainError, ValidationError } from "@/shared/errors";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";
import { CADENAS_CONVERTIBLES, UNIDADES_PRACTICAS } from "@/shared/format/cantidad";
import { parsearActividad } from "./actividad";

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
    const numero = interpretarNumero(value);
    if (!numero.ok) {
      ctx.addIssue({ code: "custom", message: numero.mensaje });
      return z.NEVER;
    }
    const parsed = new Decimal(numero.valor);
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
    const numero = interpretarNumero(value);
    if (!numero.ok) {
      ctx.addIssue({ code: "custom", message: numero.mensaje });
      return z.NEVER;
    }
    const parsed = new Decimal(numero.valor);
    if (!parsed.isFinite() || parsed.isNegative()) {
      ctx.addIssue({ code: "custom", message: "Debe ser cero o mayor." });
      return z.NEVER;
    }
    return parsed;
  });

/** `partida.potencia_declarada` (migration 0058's `partida_potencia_declarada_check`): the lot's purity, in percent, 0 < p <= 100. */
export const potenciaDeclaradaString = z
  .string()
  .trim()
  .min(1, "Este campo no puede estar vacío.")
  .transform((value, ctx) => {
    const numero = interpretarNumero(value);
    if (!numero.ok) {
      ctx.addIssue({ code: "custom", message: numero.mensaje });
      return z.NEVER;
    }
    const parsed = new Decimal(numero.valor);
    if (!parsed.isFinite() || !parsed.greaterThan(0) || parsed.greaterThan(100)) {
      ctx.addIssue({ code: "custom", message: "La pureza debe ser mayor que 0 y como máximo 100 %." });
      return z.NEVER;
    }
    return parsed;
  });

export const TIPOS_INGRESO_PARTIDA = ["GRAMOS", "UI"] as const;
export type TipoIngresoPartida = (typeof TIPOS_INGRESO_PARTIDA)[number];

/**
 * Parses a positive U.I./g activity either as a plain positive number (`"100"`)
 * or as a certificate expression (`"1000 U.I. cada 10 g"`, `"10 g cada 1000 U.I."`, `"100 U.I./g"`).
 */
export function parsearActividadOValor(raw: string): { ok: true; uiPorGramo: Decimal } | { ok: false; mensaje: string } {
  const limpio = raw.trim();
  if (!limpio) {
    return { ok: false, mensaje: "Ingresá la actividad (ej. 1000 U.I. cada 10 g)." };
  }
  const numero = interpretarNumero(limpio);
  if (numero.ok) {
    const parsed = new Decimal(numero.valor);
    if (!parsed.isFinite() || !parsed.greaterThan(0)) {
      return { ok: false, mensaje: "La actividad (U.I./g) debe ser mayor que cero." };
    }
    return { ok: true, uiPorGramo: parsed };
  }
  return parsearActividad(limpio);
}

/** `partida.actividad_declarada` (migration 0133's `partida_actividad_declarada_check`): U.I. per gram, > 0. */
export const actividadDeclaradaString = z
  .string()
  .trim()
  .min(1, "Ingresá la actividad (ej. 1000 U.I. cada 10 g).")
  .transform((value, ctx) => {
    const res = parsearActividadOValor(value);
    if (!res.ok) {
      ctx.addIssue({ code: "custom", message: res.mensaje });
      return z.NEVER;
    }
    return res.uiPorGramo;
  });

/**
 * Validates the intake kind ("GRAMOS" vs "UI") and exclusivity between `potenciaDeclarada` and `actividadDeclarada`
 * (UI4, proposal D4):
 * - Marked droga (`seDosificaEnUi`): `tipoIngreso` is required (no default).
 *   - "UI": `actividadDeclarada` required, `potenciaDeclarada` must be absent.
 *   - "GRAMOS": `actividadDeclarada` must be absent, `potenciaDeclarada` optional.
 * - Unmarked droga: `tipoIngreso === "UI"` and `actividadDeclarada` are refused.
 */
export function validarTipoIngresoPartida(
  params: {
    seDosificaEnUi: boolean;
    tipoIngreso?: TipoIngresoPartida | null;
    potenciaDeclarada?: string | null;
    actividadDeclarada?: string | null;
  },
  campo: (nombre: string) => string = (n) => n,
): void {
  const tienePotencia = Boolean(params.potenciaDeclarada && params.potenciaDeclarada.trim() !== "");
  const tieneActividad = Boolean(params.actividadDeclarada && params.actividadDeclarada.trim() !== "");

  if (tienePotencia && tieneActividad) {
    throw new DomainError("Una partida no puede tener pureza (%) y actividad (U.I./g) al mismo tiempo.", {
      fields: [campo("actividadDeclarada"), campo("potenciaDeclarada")],
    });
  }

  if (!params.seDosificaEnUi) {
    if (params.tipoIngreso === "UI" || tieneActividad) {
      throw new ValidationError("Esta droga no se dosifica en U.I.", { fields: [campo("actividadDeclarada")] });
    }
    return;
  }

  if (!params.tipoIngreso) {
    throw new ValidationError("Elegí si la partida ingresa en gramos o en U.I.", { fields: [campo("tipoIngreso")] });
  }

  if (params.tipoIngreso === "UI") {
    if (!tieneActividad) {
      throw new ValidationError("Ingresá la actividad en U.I. (ej. 1000 U.I. cada 10 g).", {
        fields: [campo("actividadDeclarada")],
      });
    }
    if (tienePotencia) {
      throw new ValidationError("Una partida en U.I. no lleva pureza en porcentaje.", {
        fields: [campo("potenciaDeclarada")],
      });
    }
  } else {
    if (tieneActividad) {
      throw new ValidationError("Una partida en gramos no lleva actividad en U.I.", {
        fields: [campo("actividadDeclarada")],
      });
    }
  }
}

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

/**
 * Whether a movimiento of this droga needs its `asiento_contralor` (INV-L08, `fsj.movimiento_stock_validar_contralor`):
 * a controlled droga once the tenant's contralor digital is active. INGRESO_INICIAL never does (its stock is in the
 * droga's APERTURA).
 */
export function requiereAsientoContralor(tipoControl: string, fechaActivacionContralor: Date | null, ahora: Date): boolean {
  return tipoControl !== "NINGUNO" && fechaActivacionContralor !== null && fechaActivacionContralor.getTime() <= ahora.getTime();
}
