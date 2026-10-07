/**
 * Moved to `modules/drogas/domain/normalizar.ts` (docs/specs/sinonimos-droga.md):
 * the same rule now also defines droga-name uniqueness and synonym matching.
 * Re-exported here so the recetas import flow and its tests keep their import path.
 */
export { normalizarTexto, coincideNormalizado } from "@/modules/drogas/domain/normalizar";
