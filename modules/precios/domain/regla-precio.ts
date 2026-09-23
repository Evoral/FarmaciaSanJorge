/**
 * Pure rules for `regla_precio` (M08, FASE 4 point 4.6, DP-09 RESUELTA).
 * NO I/O, NO Prisma -- same discipline as modules/stock/domain/reparto.ts.
 *
 * DP-09's business rule, verbatim: "Price = cost of the drugs x margin
 * percentage. NO fixed fee, no variation by forma farmaceutica."
 *
 * DP-09, CONFIRMED by the user on 2026-09-22: `margen` is the MARKUP
 * ADDED ON TOP of cost, stored as a percentage. Cost 1000 with margen 150
 * sells at 2500. `margen = 0` means selling at cost.
 * `precioFinal = costoInsumos * (1 + margen / 100)`. This is the ONLY
 * place the formula lives -- every caller goes through it.
 */
import { Decimal, dec } from "@/shared/decimal";

/** `margen >= 0` (INV, also a DB CHECK -- see migration 0031). Zero is valid: cost with no markup at all. */
export function esMargenValido(margen: Decimal | string): boolean {
  return dec(margen).greaterThanOrEqualTo(0);
}

/**
 * `precioFinal = costoInsumos * (1 + margen / 100)`.
 *
 * DP-09, confirmed by the user on 2026-09-22: `margen` is the MARKUP ADDED
 * ON TOP of cost, not a multiplier. With cost 1000 and margen 150 the price
 * is 2500 ("I add 150% to the cost"), NOT 1500. `margen = 0` therefore
 * means selling at cost.
 *
 * `costoInsumos` may legitimately be 0 (e.g. every linea is enrase manual
 * -- es_parcial covers that case).
 */
export function calcularPrecioFinal(costoInsumos: Decimal | string, margen: Decimal | string): Decimal {
  return dec(costoInsumos).times(dec(margen).dividedBy(100).plus(1));
}

/**
 * The versioning decision (INV-PR-001) as a pure function of current state,
 * so the "close current + insert new" plan is unit-testable without a DB:
 * given whether an OPEN regla_precio currently exists, decide whether this
 * write must close a row first.
 */
export interface PlanVersionadoReglaPrecio {
  /** `true` when an existing OPEN row must be closed (vigente_hasta = instante) before the new row is inserted. */
  debeCerrarActual: boolean;
}

export function planVersionarReglaPrecio(existeReglaAbierta: boolean): PlanVersionadoReglaPrecio {
  return { debeCerrarActual: existeReglaAbierta };
}
