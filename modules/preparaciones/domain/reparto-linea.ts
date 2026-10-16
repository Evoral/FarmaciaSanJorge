/**
 * The automatic split of ONE línea de pesaje over its droga's candidate partidas
 * (docs/specs/reserva-stock-preparacion.md R1): abiertas first (oldest apertura first), then FEFO -- the order of
 * `ordenarParaConsumo` (modules/stock/domain/reparto.ts), never the ingreso date. Pure and client-safe (decimals and
 * the two pure split functions only): the server plans with it (`planificarConsumoEnTx`, `construirDatosConfirmacion`,
 * the toma's "partidas para pesar") and the reserva dialog previews an enrase manual línea with it as the user types.
 *
 *   - Non-manual línea: `proponerRepartoActivo` (./potencia.ts) -- the requirement is ACTIVE ingredient, each partida
 *     contributes physical x potencia / 100; amounts are PHYSICAL.
 *   - Enrase manual línea: `proponerReparto` over the typed (physical) quantity, no purity correction
 *     (`potenciaAplicada: null`).
 *
 * Every quantity here is in the droga's unidad base (a stock quantity): the caller converts the línea's requirement
 * before and the faltante back after (`shared/decimal/convertir-unidad.ts`).
 */
import { Decimal } from "@/shared/decimal";
import { proponerReparto } from "@/modules/stock/domain/reparto";
import { proponerRepartoActivo, type PartidaConPotencia } from "./potencia";

export interface ParteDeReparto {
  partidaId: string;
  /** PHYSICAL quantity taken from this partida, droga's unidad base. */
  cantidad: Decimal;
  /** Potencia applied (percent); `null` for an enrase manual línea (no purity correction). */
  potenciaAplicada: Decimal | null;
}

export type RepartoLinea =
  | { ok: true; partes: readonly ParteDeReparto[]; totalFisico: Decimal }
  | { ok: false; /** Droga's unidad base; ACTIVE terms for a non-manual línea. */ faltante: Decimal };

/** Splits `requeridaStock` (> 0, droga's unidad base) over `partidas`; vencidas and empty partidas are skipped. */
export function repartirLinea(
  partidas: readonly PartidaConPotencia[],
  requeridaStock: Decimal,
  jornada: string,
  esEnraseManual: boolean,
): RepartoLinea {
  if (esEnraseManual) {
    const resultado = proponerReparto(partidas, requeridaStock, jornada);
    if (!resultado.ok) return { ok: false, faltante: resultado.faltante };
    return { ok: true, partes: resultado.lineas.map((l) => ({ partidaId: l.partidaId, cantidad: l.cantidad, potenciaAplicada: null })), totalFisico: requeridaStock };
  }
  const resultado = proponerRepartoActivo(partidas, requeridaStock, jornada);
  if (!resultado.ok) return { ok: false, faltante: resultado.faltante };
  return {
    ok: true,
    partes: resultado.lineas.map((l) => ({ partidaId: l.partidaId, cantidad: l.cantidad, potenciaAplicada: l.potenciaAplicada })),
    totalFisico: resultado.totalFisico,
  };
}
