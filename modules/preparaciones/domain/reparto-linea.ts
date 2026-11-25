/**
 * The automatic split of ONE línea de pesaje over its droga's candidate partidas
 * (openspec/specs/reserva-stock-preparacion/spec.md R1): abiertas first (oldest apertura first), then FEFO -- the order of
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
import type { UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import { proponerReparto } from "@/modules/stock/domain/reparto";
import { factorDePartida, potenciaEfectiva, proponerRepartoActivo, type PartidaConPotencia } from "./potencia";

export interface ParteDeReparto {
  partidaId: string;
  /** PHYSICAL quantity taken from this partida, droga's unidad base. */
  cantidad: Decimal;
  /** Potencia applied (percent); `null` for an enrase manual / equivalencia manual línea or a U.I. lot. */
  potenciaAplicada: Decimal | null;
  /** Activity applied (U.I./g); `null` for a gram lot or manual línea. */
  actividadAplicada: Decimal | null;
}

export type RepartoLinea =
  | { ok: true; partes: readonly ParteDeReparto[]; totalFisico: Decimal }
  | { ok: false; /** Droga's unidad base (or U.I. for ACTIVIDAD); ACTIVE terms for a non-manual línea. */ faltante: Decimal };

/**
 * Whether a partida's declared kind (U.I./g vs grams/%) matches the línea's magnitude.
 * ACTIVIDAD líneas only take U.I. partidas (`actividadDeclarada` set); MASA/VOLUMEN/UNIDADES líneas only take non-U.I. partidas.
 */
export function esPartidaCompatibleConLinea(
  partida: Pick<PartidaConPotencia, "actividadDeclarada">,
  tipoMagnitudLinea: string,
): boolean {
  const esUi = partida.actividadDeclarada !== null && partida.actividadDeclarada !== undefined;
  return tipoMagnitudLinea === "ACTIVIDAD" ? esUi : !esUi;
}

/** Filters `partidas` to those compatible with `tipoMagnitudLinea`. */
export function partidasCompatiblesConLinea<T extends Pick<PartidaConPotencia, "actividadDeclarada">>(
  partidas: readonly T[],
  tipoMagnitudLinea: string,
): T[] {
  return partidas.filter((p) => esPartidaCompatibleConLinea(p, tipoMagnitudLinea));
}

/** Splits `requerida` (> 0, droga's unidad base or U.I. for ACTIVIDAD) over `partidas`; vencidas and empty partidas are skipped. */
export function repartirLinea(
  partidas: readonly PartidaConPotencia[],
  requerida: Decimal,
  jornada: string,
  esManual: boolean,
  unidadStock?: UnidadDeConversion,
): RepartoLinea {
  if (esManual) {
    const resultado = proponerReparto(partidas, requerida, jornada);
    if (!resultado.ok) return { ok: false, faltante: resultado.faltante };
    return {
      ok: true,
      partes: resultado.lineas.map((l) => ({
        partidaId: l.partidaId,
        cantidad: l.cantidad,
        potenciaAplicada: null,
        actividadAplicada: null,
      })),
      totalFisico: requerida,
    };
  }
  const resultado = proponerRepartoActivo(partidas, requerida, jornada, unidadStock);
  if (!resultado.ok) return { ok: false, faltante: resultado.faltante };
  return {
    ok: true,
    partes: resultado.lineas.map((l) => ({
      partidaId: l.partidaId,
      cantidad: l.cantidad,
      potenciaAplicada: l.potenciaAplicada,
      actividadAplicada: l.actividadAplicada,
    })),
    totalFisico: resultado.totalFisico,
  };
}

/**
 * A non-manual línea weighed for real (openspec/specs/pesada-real/spec.md): `realStock` is the PHYSICAL weight (droga's unidad
 * base) the balance showed, drained over `partidas` in the same order (abiertas first, then FEFO). Each part keeps its
 * partida's purity/activity (`potenciaAplicada` / `actividadAplicada`) so the libro and the contralor know the active it carried.
 */
export function repartirPesadaReal(partidas: readonly PartidaConPotencia[], realStock: Decimal, jornada: string): RepartoLinea {
  const resultado = proponerReparto(partidas, realStock, jornada);
  if (!resultado.ok) return { ok: false, faltante: resultado.faltante };
  const factorDe = new Map(partidas.map((p) => [p.id, factorDePartida(p)]));
  return {
    ok: true,
    partes: resultado.lineas.map((l) => {
      const f = factorDe.get(l.partidaId);
      return {
        partidaId: l.partidaId,
        cantidad: l.cantidad,
        potenciaAplicada: f?.tipo === "PORCENTAJE" ? dec(f.valor) : null,
        actividadAplicada: f?.tipo === "ACTIVIDAD" ? dec(f.uiPorGramo) : null,
      };
    }),
    totalFisico: realStock,
  };
}

/**
 * `true` when the user must choose which partida(s) a línea is weighed from (openspec/specs/reserva-stock-preparacion/spec.md
 * R25): a non-manual línea whose candidate partidas with balance declare DIFFERENT purities or activities. The weight depends on the
 * lot, so the lab weighing from another bottle than the plan's would get the dose wrong. Equal purities/activities (or a manual
 * línea, never purity-corrected) keep the automatic plan.
 */
export function requiereElegirPartida(partidas: readonly PartidaConPotencia[], esManual: boolean): boolean {
  if (esManual) return false;
  const factores = new Set(
    partidas
      .filter((p) => dec(p.cantidadDisponible).greaterThan(0))
      .map((p) =>
        p.actividadDeclarada !== null && p.actividadDeclarada !== undefined
          ? `UI:${dec(p.actividadDeclarada).toString()}`
          : `P:${potenciaEfectiva(p.potenciaDeclarada).toString()}`,
      ),
  );
  return factores.size > 1;
}
