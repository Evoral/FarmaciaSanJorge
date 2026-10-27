/**
 * INV-S18 (M11, FASE 8 point 8.3), on its own so the confirmation form can run it in the browser: it imports nothing
 * but decimals (./preparacion.ts pulls `shared/errors`, which is server-only). Re-exported by ./preparacion.ts.
 */
import { Decimal } from "@/shared/decimal";
import type { PartidaDisponible } from "@/modules/stock/domain/reparto";
import { activoDesdeFisico } from "./potencia";

// ============================================================================
// INV-S18 [PROPUESTA TÉCNICA -- openspec/specs/libro-recetario-y-contralor/spec.md
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
