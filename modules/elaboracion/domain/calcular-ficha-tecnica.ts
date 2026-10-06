/**
 * Pure calculation of a FichaTecnica's LineaPesaje rows from an ItemReceta
 * and its ComponenteItemReceta formula (M10, FASE 1 point 1.10). No DB
 * access, no I/O -- see tests/unit/calcular-ficha-tecnica.test.ts (T1-T8
 * from the spec, plus one case per V1-V9 and the R7/R8 interplay).
 *
 * SOURCE OF TRUTH: docs/specs/ficha-tecnica.md. Implements rules R1-R9 and
 * validations V1-V9 EXACTLY as written there -- read that file before
 * changing anything here, it is more precise than this comment.
 *
 * All arithmetic uses `Decimal` (shared/decimal) -- `number` (float) is
 * never used for a quantity, per INV-PL-003 / the spec's own "No usar
 * float en ningun paso".
 *
 * PENDING CONFIRMATION (spec section "Pendiente de confirmar"):
 * `precisionBalanza` is defined in GRAMO (MASA) only. There is no rule for
 * rounding a non-manual line of magnitude VOLUMEN or UNIDADES (e.g.
 * glicerina 10 ml TOTAL). This implementation applies `precisionBalanza`
 * ONLY to MASA lines (see `redondearAMultiplo` call site below) and leaves
 * VOLUMEN/UNIDADES lines at full Decimal precision (exceso applied, no
 * rounding) -- flagged here and in the delivery report, not a guess to be
 * relied on without confirming with the pharmacist.
 */
import { Decimal, dec } from "@/shared/decimal";
import { DomainError } from "@/shared/errors";
import { ordenarComponentes } from "./orden-componentes";

export type TipoMagnitud = "MASA" | "VOLUMEN" | "UNIDADES";

/**
 * The subset of UnidadMedida fields the calculator needs. `factorABase` is
 * "value in the magnitude's base unit, per 1 of this unit" -- exactly
 * fsj.unidad_medida.factor_a_base's meaning (migration 0006); a base unit
 * itself always has factorABase = 1.
 */
export interface UnidadMedidaRef {
  id: string;
  tipoMagnitud: TipoMagnitud;
  factorABase: Decimal | string | number;
}

/**
 * PROPUESTA (fsj.forma_farmaceutica, migration 0011 -- not enumerated in
 * the plan/spec). Only CAPSULA/COMPRIMIDO are special-cased by R3/R5/V4
 * below ("formas capsulares") -- every other value behaves identically.
 */
export type FormaFarmaceutica =
  | "CAPSULA"
  | "COMPRIMIDO"
  | "CREMA"
  | "GEL"
  | "UNGUENTO"
  | "JARABE"
  | "SOLUCION"
  | "SUSPENSION"
  | "POLVO"
  | "OVULO"
  | "SUPOSITORIO"
  | "LOCION";

const FORMAS_CAPSULARES: ReadonlySet<FormaFarmaceutica> = new Set(["CAPSULA", "COMPRIMIDO"]);

export type ModoExpresion = "TOTAL" | "POR_DOSIS" | "CS" | "CSP";

export interface ItemRecetaInput {
  formaFarmaceutica: FormaFarmaceutica;
  cantidadTotal: Decimal | string | number | null;
  unidadTotal: UnidadMedidaRef | null;
  cantidadUnidades: number;
  /** Default 1 ("1/2 dosis" = 0.5) -- caller passes the resolved value (DB default), not omitted. */
  fraccionDosisPorUnidad: Decimal | string | number;
}

export interface ComponenteInput {
  drogaId: string;
  /** Frozen snapshot passed straight through to the output line (INV-F05) -- this function never reads a Droga catalog. */
  drogaNombre: string;
  cantidad: Decimal | string | number | null;
  unidadMedida: UnidadMedidaRef;
  modoExpresion: ModoExpresion;
}

export interface ParametrosPesaje {
  /** In GRAMO -- see the "Pending confirmation" note above for non-MASA lines. */
  precisionBalanza: Decimal | string | number;
  excesoPesadaPorcentaje: Decimal | string | number;
}

export interface LineaPesajeCalculada {
  drogaId: string;
  drogaNombre: string;
  cantidadTeorica: Decimal | null;
  excesoAplicado: Decimal;
  cantidadAPesar: Decimal | null;
  /** Always the BASE unit of the line's magnitude (spec: "unidad base de la magnitud"), never the unit the component was declared in. */
  unidadMedida: UnidadMedidaRef;
  esEnraseManual: boolean;
  /** 0-based position among the item's lines -- the componentes in `ordenarComponentes` order (they carry no stored order of their own). */
  orden: number;
}

/** One of V1-V9 from the spec. `validationCode` is the exact `V<n>` token -- assert on it in tests, not on message text. */
export class FichaTecnicaValidationError extends DomainError {
  constructor(
    public readonly validationCode: string,
    message: string,
  ) {
    super(`${validationCode}: ${message}`);
    this.name = "FichaTecnicaValidationError";
  }
}

function fail(code: string, message: string): never {
  throw new FichaTecnicaValidationError(code, message);
}

/** Converts `valor` (expressed in `unidad`) into `unidad`'s magnitude base unit (R9). */
function aBase(valor: Decimal, unidad: UnidadMedidaRef): Decimal {
  return valor.times(dec(unidad.factorABase));
}

/** R8: rounds `valor` to the nearest multiple of `precision`, half-up. */
function redondearAMultiplo(valor: Decimal, precision: Decimal): Decimal {
  if (precision.isZero()) return valor;
  return valor.dividedBy(precision).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(precision);
}

/** R7 + R8 (MASA only -- see the module doc comment's "Pending confirmation" note). */
function calcularLineaNoManual(
  c: ComponenteInput,
  orden: number,
  teorica: Decimal,
  excesoPct: Decimal,
  precisionBalanza: Decimal,
  unidadBase: UnidadMedidaRef,
): LineaPesajeCalculada {
  const conExceso = teorica.times(dec(1).plus(excesoPct.dividedBy(100)));
  const aPesar = unidadBase.tipoMagnitud === "MASA" ? redondearAMultiplo(conExceso, precisionBalanza) : conExceso;

  return {
    drogaId: c.drogaId,
    drogaNombre: c.drogaNombre,
    cantidadTeorica: teorica,
    excesoAplicado: excesoPct,
    cantidadAPesar: aPesar,
    unidadMedida: unidadBase,
    esEnraseManual: false,
    orden,
  };
}

function calcularLineaManual(c: ComponenteInput, orden: number, unidadBase: UnidadMedidaRef, excesoPct: Decimal): LineaPesajeCalculada {
  return {
    drogaId: c.drogaId,
    drogaNombre: c.drogaNombre,
    cantidadTeorica: null,
    excesoAplicado: excesoPct,
    cantidadAPesar: null,
    unidadMedida: unidadBase,
    esEnraseManual: true,
    orden,
  };
}

/**
 * Generates the LineaPesaje rows for one ItemReceta, one per componente in
 * `ordenarComponentes` order. Throws `FichaTecnicaValidationError` (never
 * generates a ficha) on V1-V9 (V3 no longer exists: componentes have no
 * order since migration 0065).
 *
 * `unidadesBase` resolves, for each `TipoMagnitud` that appears among the
 * components/total, the BASE UnidadMedidaRef to tag the output line with
 * (spec: LineaPesaje.unidadMedida is always the base unit of its
 * magnitude) -- callers resolve this from the unidad_medida catalog
 * (`WHERE es_base`) before calling, keeping this function DB-free.
 */
export function calcularFichaTecnica(
  item: ItemRecetaInput,
  componentes: ComponenteInput[],
  parametros: ParametrosPesaje,
  unidadesBase: Record<TipoMagnitud, UnidadMedidaRef>,
): LineaPesajeCalculada[] {
  // V1
  if (componentes.length === 0) {
    fail("V1", "item_receta has no components");
  }

  // V8
  const fraccion = dec(item.fraccionDosisPorUnidad);
  if (fraccion.lessThanOrEqualTo(0) || fraccion.greaterThan(1)) {
    fail("V8", `fraccionDosisPorUnidad must be in (0, 1], got ${fraccion.toString()}`);
  }

  // V9
  if (!Number.isInteger(item.cantidadUnidades) || item.cantidadUnidades <= 0) {
    fail("V9", `cantidadUnidades must be a positive integer, got ${item.cantidadUnidades}`);
  }

  const ordenados = ordenarComponentes(componentes);

  // V6 / V7, per component.
  for (const c of ordenados) {
    const requiereCantidad = c.modoExpresion === "TOTAL" || c.modoExpresion === "POR_DOSIS";
    if (requiereCantidad) {
      if (c.cantidad === null || dec(c.cantidad).lessThanOrEqualTo(0)) {
        fail("V6", `componente ${c.drogaId} (${c.modoExpresion}) requires cantidad > 0`);
      }
    } else if (c.cantidad !== null) {
      fail("V7", `componente ${c.drogaId} (${c.modoExpresion}) must have cantidad = null`);
    }
  }

  // V2
  const csp = ordenados.filter((c) => c.modoExpresion === "CSP");
  if (csp.length > 1) {
    fail("V2", `more than one CSP component (${csp.length})`);
  }

  const esCapsular = FORMAS_CAPSULARES.has(item.formaFarmaceutica);

  // V4 -- only applies to non-capsular forms (T3's clarification).
  if (csp.length === 1 && !esCapsular && (item.cantidadTotal === null || item.unidadTotal === null)) {
    fail("V4", "CSP present on a non-capsular form requires cantidadTotal and unidadTotal");
  }

  // R1 / R2 / R9: theoretical quantity (in base unit) for TOTAL / POR_DOSIS components.
  const teoricaPorComponente = new Map<ComponenteInput, Decimal>();
  for (const c of ordenados) {
    if (c.modoExpresion === "TOTAL") {
      teoricaPorComponente.set(c, aBase(dec(c.cantidad!), c.unidadMedida));
    } else if (c.modoExpresion === "POR_DOSIS") {
      const enUnidadPropia = dec(c.cantidad!).times(fraccion).times(item.cantidadUnidades);
      teoricaPorComponente.set(c, aBase(enUnidadPropia, c.unidadMedida));
    }
  }

  const excesoPct = dec(parametros.excesoPesadaPorcentaje);
  const precisionBalanza = dec(parametros.precisionBalanza);

  const lineas: LineaPesajeCalculada[] = [];

  for (const [orden, c] of ordenados.entries()) {
    const unidadBaseComponente = unidadesBase[c.unidadMedida.tipoMagnitud];

    if (c.modoExpresion === "CS") {
      // R6: always manual, never part of R3's subtraction/magnitude check.
      lineas.push(calcularLineaManual(c, orden, unidadBaseComponente, excesoPct));
      continue;
    }

    if (c.modoExpresion === "TOTAL" || c.modoExpresion === "POR_DOSIS") {
      const teorica = teoricaPorComponente.get(c)!;
      lineas.push(calcularLineaNoManual(c, orden, teorica, excesoPct, precisionBalanza, unidadBaseComponente));
      continue;
    }

    // c.modoExpresion === "CSP"
    if (esCapsular) {
      // R5: capsules/tablets always complete the excipient by volume when preparing.
      lineas.push(calcularLineaManual(c, orden, unidadBaseComponente, excesoPct));
      continue;
    }

    // R3 / R4 -- V4 above guarantees unidadTotal/cantidadTotal are set here.
    const magnitudTotal = item.unidadTotal!.tipoMagnitud;
    // R3's clarification: CS components are excluded from both the
    // subtraction and the "same magnitude" check.
    const otros = ordenados.filter((o) => o !== c && o.modoExpresion !== "CS");
    const magnitudesDistintas = otros.some((o) => o.unidadMedida.tipoMagnitud !== magnitudTotal);

    if (magnitudesDistintas) {
      // R4: mixed magnitudes -> always manual.
      lineas.push(calcularLineaManual(c, orden, unidadesBase[c.unidadMedida.tipoMagnitud], excesoPct));
      continue;
    }

    let sumaOtros = dec(0);
    for (const o of otros) {
      const t = teoricaPorComponente.get(o);
      if (t) sumaOtros = sumaOtros.plus(t);
    }

    const totalEnBase = aBase(dec(item.cantidadTotal!), item.unidadTotal!);
    const teoricaCsp = totalEnBase.minus(sumaOtros);

    // V5
    if (teoricaCsp.lessThanOrEqualTo(0)) {
      fail("V5", `CSP result is <= 0 (total ${totalEnBase.toString()}, components sum ${sumaOtros.toString()})`);
    }

    lineas.push(calcularLineaNoManual(c, orden, teoricaCsp, excesoPct, precisionBalanza, unidadesBase[magnitudTotal]));
  }

  return lineas;
}
