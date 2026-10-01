/**
 * Pure rules for `regla_precio` (M08). NO I/O, NO Prisma -- same discipline
 * as modules/stock/domain/reparto.ts.
 *
 * Price rule set confirmed by the user on 2026-10-01 (docs/specs/reglas-precio.md),
 * superseding DP-09's single global margen:
 *
 *   precioFinal = max(costo * (1 + margenTramo / 100), precioMinimo)
 *
 * - `costo` is the costoInsumos of ONE preparación (one item / cotización):
 *   each item is priced on its own, never summed across a receta first.
 * - Tramos by cost: an ordered list, each with an INCLUSIVE upper bound
 *   `costoHasta` (lower bound = the previous tramo's `costoHasta`,
 *   exclusive; the first starts at 0 inclusive); the LAST tramo has
 *   `costoHasta = null` (no upper limit). "More than X" is strictly
 *   greater: a cost exactly equal to a tramo's `costoHasta` belongs to THAT
 *   tramo.
 * - The tramo's markup applies to the WHOLE cost -- NOT progressive
 *   brackets. So the price can DROP across a boundary: with "<= 100000 ->
 *   +100%, > 100000 -> +70%", cost 100000 sells at 200000 and cost 100001
 *   at 170001.70. That drop is INTENDED by the business -- do not "fix" it.
 * - The floor: no preparación is ever priced below `precioMinimo`. It is
 *   compared against the tramo price, not the cost (cost 15000 at +100% ->
 *   30000, untouched by a 20000 floor; cost 5000 at +100% -> 10000 ->
 *   raised to 20000). A cost of 0 (every linea enrase manual / nothing in
 *   stock) is therefore priced at the floor too.
 *
 * `calcularPrecioFinal` is the ONLY place the formula lives -- every caller
 * goes through it. `validarReglasPrecio` is the ONLY definition of a valid
 * rule set (mirrored by the DB's INV-PR-002 deferred check, migration 0052).
 */
import { Decimal, dec } from "@/shared/decimal";

export interface TramoMargen {
  /** Inclusive upper bound of the cost this tramo covers; `null` only on the last tramo (no upper limit). */
  costoHasta: Decimal | string | null;
  /** Markup percentage added on top of the WHOLE cost (100 = price is twice the cost). */
  margen: Decimal | string;
}

export interface ReglasPrecio {
  /** Floor for every preparación's price. 0 = no floor. */
  precioMinimo: Decimal | string;
  /** Ordered by cost; see the module doc comment for the semantics. */
  tramos: readonly TramoMargen[];
}

// ============================================================================
// Validation
// ============================================================================

/** One problem with a rule set. `indiceTramo` (0-based) is set for problems of a specific tramo. */
export interface ProblemaReglaPrecio {
  campo: "precioMinimo" | "tramos" | "costoHasta" | "margen";
  indiceTramo?: number;
  mensaje: string;
}

/** `margen >= 0`. Zero is valid: cost with no markup at all. */
export function esMargenValido(margen: Decimal | string): boolean {
  return dec(margen).greaterThanOrEqualTo(0);
}

/**
 * Every problem with `reglas` (empty array = valid): at least one tramo,
 * every margen >= 0, precioMinimo >= 0, every costoHasta > 0 and strictly
 * increasing, and `null` exactly on the last tramo. Together these make
 * overlaps and gaps impossible by construction.
 */
export function validarReglasPrecio(reglas: ReglasPrecio): ProblemaReglaPrecio[] {
  const problemas: ProblemaReglaPrecio[] = [];

  if (dec(reglas.precioMinimo).lessThan(0)) {
    problemas.push({ campo: "precioMinimo", mensaje: "El precio mínimo debe ser mayor o igual a 0." });
  }

  if (reglas.tramos.length === 0) {
    problemas.push({ campo: "tramos", mensaje: "Cargá al menos un tramo de margen." });
    return problemas;
  }

  const ultimo = reglas.tramos.length - 1;
  let anterior: Decimal | null = null;
  reglas.tramos.forEach((tramo, i) => {
    if (!esMargenValido(tramo.margen)) {
      problemas.push({ campo: "margen", indiceTramo: i, mensaje: "El margen debe ser mayor o igual a 0." });
    }

    if (tramo.costoHasta === null) {
      if (i !== ultimo) {
        problemas.push({ campo: "costoHasta", indiceTramo: i, mensaje: "Solo el último tramo puede quedar sin tope: indicá el costo hasta el que aplica." });
      }
      return;
    }

    const hasta = dec(tramo.costoHasta);
    if (i === ultimo) {
      problemas.push({ campo: "costoHasta", indiceTramo: i, mensaje: "El último tramo no lleva tope: cubre cualquier costo mayor al del tramo anterior." });
    } else if (hasta.lessThanOrEqualTo(0)) {
      problemas.push({ campo: "costoHasta", indiceTramo: i, mensaje: "El costo hasta debe ser mayor que 0." });
    } else if (anterior !== null && hasta.lessThanOrEqualTo(anterior)) {
      problemas.push({ campo: "costoHasta", indiceTramo: i, mensaje: "El costo hasta debe ser mayor que el del tramo anterior (los tramos no pueden superponerse)." });
    }
    anterior = hasta;
  });

  return problemas;
}

// ============================================================================
// The formula
// ============================================================================

export interface PrecioCalculado {
  precioFinal: Decimal;
  /** The markup of the tramo the cost fell into (applied even when the floor then raised the price). */
  margenAplicado: Decimal;
  /** 0-based index of that tramo in `reglas.tramos`. */
  tramoAplicado: number;
  /** `true` when the tramo price was below `precioMinimo` and the floor was used instead. */
  precioMinimoAplicado: boolean;
}

/** The 0-based index of the tramo `costo` belongs to: the first with `costo <= costoHasta`, or the open-ended last one. */
export function indiceTramoParaCosto(costo: Decimal | string, tramos: readonly TramoMargen[]): number {
  const valor = dec(costo);
  const indice = tramos.findIndex((t) => t.costoHasta === null || valor.lessThanOrEqualTo(dec(t.costoHasta)));
  if (indice === -1) {
    throw new Error(`indiceTramoParaCosto: no tramo covers cost ${valor.toString()} -- the rule set is invalid (the last tramo must have costoHasta = null; see validarReglasPrecio).`);
  }
  return indice;
}

/**
 * `precioFinal = max(costoInsumos * (1 + margenTramo / 100), precioMinimo)`
 * -- see the module doc comment for tramo/boundary semantics and the
 * INTENDED price drop at a boundary. `reglas` must be valid
 * (`validarReglasPrecio`); a rule set no tramo covers throws.
 *
 * `costoInsumos` may legitimately be 0 (e.g. every linea is enrase manual
 * -- es_parcial covers that case): the floor then sets the price.
 */
export function calcularPrecioFinal(costoInsumos: Decimal | string, reglas: ReglasPrecio): PrecioCalculado {
  const costo = dec(costoInsumos);
  const tramoAplicado = indiceTramoParaCosto(costo, reglas.tramos);
  const margenAplicado = dec(reglas.tramos[tramoAplicado]!.margen);
  const precioTramo = costo.times(margenAplicado.dividedBy(100).plus(1));
  const precioMinimo = dec(reglas.precioMinimo);
  const precioMinimoAplicado = precioTramo.lessThan(precioMinimo);
  return {
    precioFinal: precioMinimoAplicado ? precioMinimo : precioTramo,
    margenAplicado,
    tramoAplicado,
    precioMinimoAplicado,
  };
}

/**
 * One-line Spanish summary of a tramo list, for the audit trail (a nested
 * array would otherwise show as raw JSON): "hasta 100000: +100%; más de
 * 100000: +70%". A single open tramo reads "cualquier costo: +100%".
 */
export function describirTramos(tramos: readonly TramoMargen[]): string {
  return tramos
    .map((tramo, i) => {
      const anterior = i > 0 ? tramos[i - 1]!.costoHasta : null;
      const rango =
        tramo.costoHasta !== null ? `hasta ${dec(tramo.costoHasta).toString()}` : anterior !== null ? `más de ${dec(anterior).toString()}` : "cualquier costo";
      return `${rango}: +${dec(tramo.margen).toString()}%`;
    })
    .join("; ");
}

// ============================================================================
// Versioning (INV-PR-001)
// ============================================================================

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
