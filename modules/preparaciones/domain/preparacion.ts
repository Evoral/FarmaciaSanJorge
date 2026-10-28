/**
 * Pure domain rules for M11 (preparación), FASE 8 points 8.1-8.3. No I/O, no
 * Prisma (eslint's domainBoundaryPatterns enforce this structurally).
 *
 * Reuses `modules/stock/domain/reparto.ts#proponerReparto` for the actual
 * split algorithm (INV-S13/S19/S20, FEFO + abierta-first) -- this file only
 * adds the FASE 8-specific rules layered on top of a reparto result:
 *   - INV-S15: the farmacéutico may choose a DIFFERENT set of partidas than
 *     the system's own proposal; the amounts are still always computed by
 *     the system (never typed by the user) for whatever set is chosen.
 *   - INV-S18: opening a partida that would NOT have been necessary (an
 *     already-open partida for the same droga alone covers the requirement)
 *     requires an explicit motivo.
 *   - Manual-enrase lines (openspec/specs/ficha-tecnica/spec.md): the pharmacist
 *     types the REAL quantity used at confirmation time; it must be > 0.
 */
import { Decimal } from "@/shared/decimal";
import { ValidationError } from "@/shared/errors";

// ============================================================================
// Manual-enrase line: the real quantity, typed by the pharmacist at
// confirmation (openspec/specs/ficha-tecnica/spec.md, revised INV-S12).
// ============================================================================

/** Throws `ValidationError` unless `cantidad` is a finite, strictly positive `Decimal`. */
export function validarCantidadManual(cantidad: Decimal, lineaOrden: number): void {
  if (!cantidad.isFinite() || cantidad.lessThanOrEqualTo(0)) {
    throw new ValidationError(
      `La línea ${lineaOrden + 1} es de enrase manual: la cantidad real registrada debe ser mayor que 0.`,
    );
  }
}

// ============================================================================
// INV-S15: deviation from the system's own proposal.
// ============================================================================

/**
 * `true` when the set of partida ids actually drawn from (`elegidas`)
 * differs from the set the system proposed (`propuestas`) for the SAME
 * línea -- order-independent (choosing the same partidas in a different
 * order is not a deviation; the amounts are recomputed either way).
 */
export function esDesvioPropuesta(propuestas: readonly string[], elegidas: readonly string[]): boolean {
  if (propuestas.length !== elegidas.length) return true;
  const propuestasSet = new Set(propuestas);
  return elegidas.some((id) => !propuestasSet.has(id));
}

// INV-S18 lives in ./apertura-adicional.ts (client-safe: the confirmation form runs it too).
export { requiereMotivoAperturaAdicional, type PartidaConEstadoApertura } from "./apertura-adicional";

// ============================================================================
// Snapshot texts for the asiento_recetario (INV-L05) -- built here (pure)
// so the application layer just assembles strings from already-loaded data.
// ============================================================================

export function formatearMedicoTexto(nombre: string, apellido: string, matricula: string): string {
  return `${apellido}, ${nombre} — matrícula ${matricula}`;
}

export function formatearPacienteTexto(nombre: string, apellido: string): string {
  return `${apellido}, ${nombre}`;
}

export interface LineaFormulaTexto {
  drogaNombre: string;
  cantidad: string;
  unidadSimbolo: string;
  esEnraseManual: boolean;
}

/** One line per ficha line, in the ficha's line order, "Droga — cantidad unidad" (enrase manual notes the real registered quantity). */
export function formatearFormulaTexto(lineas: readonly LineaFormulaTexto[]): string {
  return lineas
    .map((l) => `${l.drogaNombre}: ${l.cantidad} ${l.unidadSimbolo}${l.esEnraseManual ? " (enrase manual)" : ""}`)
    .join("; ");
}

// 8.5: etiqueta content lives in ./etiqueta.ts.
