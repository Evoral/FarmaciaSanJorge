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
import { Decimal, dec } from "@/shared/decimal";
import { proponerReparto } from "@/modules/stock/domain/reparto";
import { potenciaEfectiva, proponerRepartoActivo, type PartidaConPotencia } from "./potencia";

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

/**
 * A non-manual línea weighed for real (docs/specs/pesada-real.md): `realStock` is the PHYSICAL weight (droga's unidad
 * base) the balance showed, drained over `partidas` in the same order (abiertas first, then FEFO). Each part keeps its
 * partida's purity (`potenciaAplicada`) so the libro and the contralor know the active it carried.
 */
export function repartirPesadaReal(partidas: readonly PartidaConPotencia[], realStock: Decimal, jornada: string): RepartoLinea {
  const resultado = proponerReparto(partidas, realStock, jornada);
  if (!resultado.ok) return { ok: false, faltante: resultado.faltante };
  const potenciaDe = new Map(partidas.map((p) => [p.id, potenciaEfectiva(p.potenciaDeclarada)]));
  return {
    ok: true,
    partes: resultado.lineas.map((l) => ({ partidaId: l.partidaId, cantidad: l.cantidad, potenciaAplicada: potenciaDe.get(l.partidaId) ?? null })),
    totalFisico: realStock,
  };
}

/**
 * `true` when the user must choose which partida(s) a línea is weighed from (docs/specs/reserva-stock-preparacion.md
 * R25): a non-manual línea whose candidate partidas with balance declare DIFFERENT purities. The weight depends on the
 * lot, so the lab weighing from another bottle than the plan's would get the dose wrong. Equal purities (or an enrase
 * manual línea, never purity-corrected) keep the automatic plan.
 */
export function requiereElegirPartida(partidas: readonly PartidaConPotencia[], esEnraseManual: boolean): boolean {
  if (esEnraseManual) return false;
  const potencias = new Set(
    partidas.filter((p) => dec(p.cantidadDisponible).greaterThan(0)).map((p) => potenciaEfectiva(p.potenciaDeclarada).toString()),
  );
  return potencias.size > 1;
}
