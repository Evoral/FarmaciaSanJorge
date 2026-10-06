import { z } from "zod";
import { Decimal } from "decimal.js";

/**
 * Pure domain types/rules for the droga catalog (M06, FASE 4 point 4.2).
 * The DB is authoritative for `es_controlada = (tipo_control <> 'NINGUNO')`
 * (migration 0007's CHECK) -- `tipoControlValido` below is the same rule,
 * duplicated ONLY as a fast pre-DB check for a clear Spanish form error
 * (mirrors modules/directores-tecnicos/domain/designacion.ts's
 * `validarRangoVigencia`).
 *
 * DP-12 is UNRESOLVED (plan §21): whether esControlada/tipoControl/
 * unidadBaseId may change once a droga has partidas. This task's binding
 * decision is conservative -- REJECT any such change once the droga has ANY
 * partida (`puedeCambiarClasificacion` below), never enforced in the DB
 * (migration 0007 explicitly says INV-DRG-001 is NOT enforced there) --
 * this is purely an [APP] rule, checked in `application/editar-droga.ts`
 * against a fresh `tieneAlgunaPartida` read.
 */
export const TIPOS_CONTROL = ["NINGUNO", "PSICOTROPICO", "ESTUPEFACIENTE"] as const;
export type TipoControl = (typeof TIPOS_CONTROL)[number];

const TIPOS_CONTROL_SET: ReadonlySet<string> = new Set(TIPOS_CONTROL);

export function esTipoControl(value: string): value is TipoControl {
  return TIPOS_CONTROL_SET.has(value);
}

/** Neutral, professional Spanish -- UI copy. */
export const TIPO_CONTROL_LABELS: Record<TipoControl, string> = {
  NINGUNO: "Ninguno",
  PSICOTROPICO: "Psicotrópico",
  ESTUPEFACIENTE: "Estupefaciente",
};

/** Mirrors migration 0007's `droga_es_controlada_check`: esControlada must agree with tipoControl <> NINGUNO. */
export function tipoControlValido(esControlada: boolean, tipoControl: TipoControl): boolean {
  return esControlada === (tipoControl !== "NINGUNO");
}

/**
 * Migration 0063: what a catalog row is. DROGA = active ingredient (the
 * default); EXCIPIENTE (fillers, vehicles, solvents) and MATERIAL
 * (capsules, containers) are "insumos": same stock and cost tracking, but
 * left out of the libro recetario, and never controlled.
 */
export const CLASES_DROGA = ["DROGA", "EXCIPIENTE", "MATERIAL"] as const;
export type ClaseDroga = (typeof CLASES_DROGA)[number];

export const CLASE_DROGA_LABELS: Record<ClaseDroga, string> = {
  DROGA: "Droga",
  EXCIPIENTE: "Excipiente",
  MATERIAL: "Material",
};

/** Mirrors migration 0063's `droga_clase_no_controlada_check`: only a DROGA can be controlled. */
export function claseValida(clase: ClaseDroga, tipoControl: TipoControl): boolean {
  return clase === "DROGA" || tipoControl === "NINGUNO";
}

export const MENSAJE_INSUMO_CONTROLADO = "Un excipiente o material no puede ser controlado: elegí la clase Droga o el tipo de control Ninguno.";

/**
 * DP-12 (task's binding, conservative decision): once a droga has ANY
 * partida, its esControlada/tipoControl/unidadBaseId become immutable at
 * the application layer -- changing controlled status after partidas exist
 * would break the contralor ledger's continuity (task instruction). `true`
 * means the classification may still change.
 */
export function puedeCambiarClasificacion(tienePartidas: boolean): boolean {
  return !tienePartidas;
}

/**
 * A string that parses to a `Decimal >= 0` -- mirrors migration 0007's
 * `droga_stock_minimo_check`. Not in `shared/validation` (that file only has
 * `decimalString`/`positiveDecimalString`, no `>= 0` variant) -- kept local
 * to this module rather than widening a shared primitive for one field, same
 * convention as `modules/directores-tecnicos/domain/designacion.ts`'s local
 * `isoDate`.
 */
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
