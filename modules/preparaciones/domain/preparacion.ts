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
 *   - Manual-enrase lines (docs/specs/ficha-tecnica.md): the pharmacist
 *     types the REAL quantity used at confirmation time; it must be > 0.
 */
import { Decimal } from "@/shared/decimal";
import { ValidationError } from "@/shared/errors";
import type { PartidaDisponible } from "@/modules/stock/domain/reparto";
import { activoDesdeFisico } from "./potencia";

// ============================================================================
// Manual-enrase line: the real quantity, typed by the pharmacist at
// confirmation (docs/specs/ficha-tecnica.md, revised INV-S12).
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

// ============================================================================
// INV-S18 [PROPUESTA TÉCNICA -- docs/specs/libro-recetario-y-contralor.md
// does not spell this invariant out in full; this is the reading FASE 8's
// task instructions describe: "si se abre una segunda partida de la misma
// droga mientras hay una abierta con saldo suficiente, exigir motivo"].
//
// `proponerReparto` (reparto.ts) ALWAYS drains an abierta partida with
// balance FIRST, so under the system's own DEFAULT proposal this never
// fires -- it only fires when the farmacéutico OVERRIDES the partida
// selection (INV-S15) to include a partida that is not yet open, while an
// already-open partida for the same droga would, on its own, have covered
// the whole requirement.
// ============================================================================

export interface PartidaConEstadoApertura extends PartidaDisponible {
  /** `true` when this partida is included in the CHOSEN split for the línea. */
  elegida: boolean;
  /** `partida.potencia_declarada` (percent, `null`/omitted = 100%). When given, balances are compared in ACTIVE terms (domain/potencia.ts). */
  potenciaDeclarada?: string | null;
}

/**
 * `true` when the chosen split opens at least one partida that was not
 * already open, WHILE the already-open partida(s) for this droga (not
 * vencidas, per INV-S10) alone had enough balance to cover `cantidadRequerida`.
 * In that case the caller must collect a `motivoAperturaAdicional`.
 * `cantidadRequerida` and the balances are compared in ACTIVE terms when the
 * partidas carry `potenciaDeclarada` (pass none for manual-enrase lines).
 */
export function requiereMotivoAperturaAdicional(
  partidas: readonly PartidaConEstadoApertura[],
  cantidadRequerida: Decimal,
  jornadaActual: string,
): boolean {
  const vigentes = (p: PartidaConEstadoApertura) => p.fechaVencimiento === null || p.fechaVencimiento >= jornadaActual;

  const saldoAbiertasVigentes = partidas
    .filter((p) => p.fechaApertura !== null && vigentes(p))
    .reduce((acc, p) => acc.plus(activoDesdeFisico(p.cantidadDisponible, p.potenciaDeclarada)), new Decimal(0));

  if (saldoAbiertasVigentes.lessThan(cantidadRequerida)) {
    // The already-open supply alone would NOT have covered the requirement
    // -- opening another partida was necessary regardless of what was chosen.
    return false;
  }

  return partidas.some((p) => p.elegida && p.fechaApertura === null);
}

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
