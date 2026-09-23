/**
 * Pure domain types for the unit-of-measure catalog (M05, FASE 4 point 4.1).
 * DP-39 RESUELTA: `fsj.unidad_medida` is a GLOBAL catalog (no `tenant_id`) --
 * every invariant (INV-M01..M04) is enforced entirely in the DB (migration
 * 0006: `fsj.convertir`, triggers, the partial unique index on `es_base`).
 * Nothing here re-implements those checks; this module only shapes input
 * and surfaces what the DB rejects.
 *
 * DP-07 is UNRESOLVED: only the magnitudes migration 0006 actually seeded
 * (MASA, VOLUMEN, UNIDADES) are offered here -- do not add
 * GOTA/UNIDAD_INTERNACIONAL/PORCENTAJE/ACTIVIDAD/PROPORCION until DP-07
 * resolves (plan's binding decision for this task).
 */
export const TIPOS_MAGNITUD = ["MASA", "VOLUMEN", "UNIDADES"] as const;
export type TipoMagnitud = (typeof TIPOS_MAGNITUD)[number];

const TIPOS_MAGNITUD_SET: ReadonlySet<string> = new Set(TIPOS_MAGNITUD);

export function esTipoMagnitud(value: string): value is TipoMagnitud {
  return TIPOS_MAGNITUD_SET.has(value);
}

/** Neutral, professional Spanish -- UI copy (same convention as modules/usuarios/domain/roles.ts's ROL_LABELS). */
export const TIPO_MAGNITUD_LABELS: Record<TipoMagnitud, string> = {
  MASA: "Masa",
  VOLUMEN: "Volumen",
  UNIDADES: "Unidades",
};

/**
 * Mirrors migration 0006's `unidad_medida_base_factor_check` (`NOT es_base
 * OR factor_a_base = 1`) -- a fast pre-DB check for a clear Spanish form
 * error, same convention as `modules/drogas/domain/droga.ts`'s
 * `tipoControlValido`. `factorABase` takes any object with an `.equals()`
 * method (a `decimal.js` `Decimal`) rather than importing decimal.js here,
 * to keep this file dependency-free like the rest of this module's domain
 * layer.
 */
export function esBaseValido(esBase: boolean, factorABase: { equals(value: number): boolean }): boolean {
  return !esBase || factorABase.equals(1);
}
