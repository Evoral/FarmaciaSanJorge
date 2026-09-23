/**
 * Pure domain rules for M09 (recetas), FASE 6 points 6.1/6.3/6.5. No I/O, no
 * Prisma (eslint's domainBoundaryPatterns enforce this structurally).
 *
 * Source of truth for the state machine: docs/specs/libro-recetario-y-contralor.md
 * section 1, already implemented as a DB trigger
 * (fsj.receta_validar_transicion_estado, migration 0011) -- the helpers
 * below MIRROR that trigger for fast, clear-message app-level pre-checks;
 * the DB remains the real backstop (docs/architecture.md's use-case
 * pattern).
 *
 * Source of truth for V1-V9: docs/specs/ficha-tecnica.md, already
 * implemented as DB CHECKs/deferred constraint triggers (migration 0011)
 * PLUS a full pure calculator (modules/elaboracion/domain/calcular-ficha-tecnica.ts,
 * FASE 1 point 1.10). V1/V2/V3/V6/V7/V8/V9 are re-implemented here (cheap,
 * no DB lookups) so a receta form gets a clear Spanish message before ever
 * reaching the DB. V4 is [APP]-only everywhere (migration 0011 header: "not
 * DB-enforceable"). **V5 is deliberately NOT checked here** -- it requires
 * resolving each componente's unidad_medida to its magnitude's base unit
 * (fsj.unidad_medida.factor_a_base), which is exactly what the ficha
 * calculator needs its `unidadesBase` argument for (FASE 7/M10, out of
 * scope for FASE 6). A receta whose CSP would net <= 0 is accepted at alta
 * time here and will be caught later when a ficha_tecnica is generated
 * (calcularFichaTecnica throws FichaTecnicaValidationError("V5", ...)) --
 * documented as a deliberate scope boundary, not an oversight.
 */
import { Decimal } from "@/shared/decimal";
import { ValidationError } from "@/shared/errors";
import type { FormaFarmaceutica, ModoExpresion } from "@/modules/elaboracion/domain/calcular-ficha-tecnica";

export type { FormaFarmaceutica, ModoExpresion };

export const FORMAS_FARMACEUTICAS = [
  "CAPSULA",
  "COMPRIMIDO",
  "CREMA",
  "GEL",
  "UNGUENTO",
  "JARABE",
  "SOLUCION",
  "SUSPENSION",
  "POLVO",
  "OVULO",
  "SUPOSITORIO",
  "LOCION",
] as const satisfies readonly FormaFarmaceutica[];

export const MODOS_EXPRESION = ["TOTAL", "POR_DOSIS", "CS", "CSP"] as const satisfies readonly ModoExpresion[];

const FORMAS_CAPSULARES: ReadonlySet<FormaFarmaceutica> = new Set(["CAPSULA", "COMPRIMIDO"]);

export type OrigenReceta = "PRESENCIAL" | "DIGITAL_PDF" | "DIGITAL_FOTO";
export const ORIGENES_RECETA = ["PRESENCIAL", "DIGITAL_PDF", "DIGITAL_FOTO"] as const satisfies readonly OrigenReceta[];

/**
 * FASE 6 binding decision: point 6.2 (attachment storage, DP-29) is
 * excluded from this phase. `archivo_adjunto_url` stays in the schema so a
 * later phase can wire uploads without reshaping the model, but the UI/app
 * layer only accepts PRESENCIAL for now -- DIGITAL_PDF/DIGITAL_FOTO are
 * rejected with a clear "pendiente" message instead of silently accepting
 * a receta with no way to ever attach its file.
 */
export const ORIGENES_HABILITADOS: readonly OrigenReceta[] = ["PRESENCIAL"];

export const MENSAJE_ORIGEN_PENDIENTE =
  "El origen digital (PDF o foto) todavía no está disponible: pendiente: carga de adjuntos. Registrá la receta como presencial.";

export function validarOrigenHabilitado(origen: OrigenReceta): void {
  if (!ORIGENES_HABILITADOS.includes(origen)) {
    throw new ValidationError(MENSAJE_ORIGEN_PENDIENTE);
  }
}

export type EstadoReceta =
  | "PENDIENTE_PREPARACION"
  | "EN_PREPARACION"
  | "PREPARADA"
  | "LISTA_PARA_RETIRAR"
  | "ENVIADA_PEND_FIRMA"
  | "ENTREGADA"
  | "ANULADA";

export const ESTADOS_RECETA = [
  "PENDIENTE_PREPARACION",
  "EN_PREPARACION",
  "PREPARADA",
  "LISTA_PARA_RETIRAR",
  "ENVIADA_PEND_FIRMA",
  "ENTREGADA",
  "ANULADA",
] as const satisfies readonly EstadoReceta[];

export const ESTADOS_TERMINALES: ReadonlySet<EstadoReceta> = new Set(["ENTREGADA", "ANULADA"]);

/** INV-R08. Mirrors fsj.receta_validar_transicion_estado exactly (migration 0011). */
export function esEstadoTerminal(estado: EstadoReceta): boolean {
  return ESTADOS_TERMINALES.has(estado);
}

/** INV-R08: ANULADA is reachable from any non-terminal state -- this is the only app-driven transition FASE 6 needs (6.5). */
export function puedeAnular(estado: EstadoReceta): boolean {
  return !esEstadoTerminal(estado);
}

/**
 * FASE 6 point 6.3 binding decision: editable (including add/remove of
 * items/componentes, backed by migration 0030's INV-R11 DELETE guard) only
 * while PENDIENTE_PREPARACION. The "no ficha con preparación" half of the
 * rule needs a DB read (modules/recetas/infrastructure/receta-repository.ts's
 * `existeFichaConPreparacionParaReceta`) so it is NOT part of this pure
 * function -- callers must check both.
 */
export function esEstadoEditable(estado: EstadoReceta): boolean {
  return estado === "PENDIENTE_PREPARACION";
}

/**
 * `fechaPrescripcion` must not be in the future, relative to the tenant's
 * jornada (server-derived, `fsj.jornada_actual(tenantId)` -- same
 * convention as modules/stock/domain/partida.ts's `esFechaVencimientoFutura`).
 * ISO `YYYY-MM-DD` strings compare correctly lexicographically.
 */
export function esFechaPrescripcionValida(fechaPrescripcion: string, jornadaActual: string): boolean {
  return fechaPrescripcion <= jornadaActual;
}

// ============================================================================
// V1-V9 (app-level pre-check, minus V5 -- see module doc comment)
// ============================================================================

export interface ComponenteInput {
  drogaId: string;
  /** Decimal string, or `null` for CS/CSP (V7). */
  cantidad: string | null;
  unidadMedidaId: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
}

export interface ItemInput {
  descripcion?: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  /** Decimal string, default "1" -- V8: must be in (0, 1]. */
  fraccionDosisPorUnidad: string;
  cantidadTotal: string | null;
  unidadTotalId: string | null;
  observaciones?: string | null;
  componentes: ComponenteInput[];
}

function parseDecimalOrFail(value: string, code: string, message: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new ValidationError(`${code}: ${message}`);
  }
  if (!parsed.isFinite()) {
    throw new ValidationError(`${code}: ${message}`);
  }
  return parsed;
}

/**
 * Validates a receta's full items/componentes tree BEFORE it reaches the
 * DB, mirroring migration 0011's CHECKs/deferred constraint triggers with
 * clear Spanish messages. Throws `ValidationError` on the FIRST violation
 * found (same "fail fast" posture as the DB's own non-deferred CHECKs).
 * `orden` is NOT part of the input here -- callers (the application layer)
 * assign it from each componente's position in its array, so the UI never
 * has to manage an explicit order number (see
 * modules/recetas/infrastructure/receta-repository.ts's insert/replace
 * functions).
 */
export function validarItemsReceta(items: ItemInput[]): void {
  // INV-R01 (app-level pre-check; the DB's deferred constraint trigger is the real backstop).
  if (items.length === 0) {
    throw new ValidationError("La receta debe tener al menos un ítem.");
  }

  items.forEach((item, itemIdx) => {
    const n = itemIdx + 1;

    // V9
    if (!Number.isInteger(item.cantidadUnidades) || item.cantidadUnidades <= 0) {
      throw new ValidationError(`V9: en el ítem ${n}, la cantidad de unidades debe ser un número entero mayor que 0.`);
    }

    // V8
    const fraccion = parseDecimalOrFail(
      item.fraccionDosisPorUnidad,
      "V8",
      `en el ítem ${n}, la fracción de dosis por unidad no es un número válido.`,
    );
    if (fraccion.lessThanOrEqualTo(0) || fraccion.greaterThan(1)) {
      throw new ValidationError(`V8: en el ítem ${n}, la fracción de dosis por unidad debe ser mayor que 0 y menor o igual a 1.`);
    }

    // V1
    if (item.componentes.length === 0) {
      throw new ValidationError(`V1: el ítem ${n} debe tener al menos un componente.`);
    }

    // V6 / V7, per componente.
    item.componentes.forEach((c, compIdx) => {
      const m = compIdx + 1;
      const requiereCantidad = c.modoExpresion === "TOTAL" || c.modoExpresion === "POR_DOSIS";
      if (requiereCantidad) {
        if (c.cantidad === null) {
          throw new ValidationError(`V6: en el ítem ${n}, el componente ${m} (${c.modoExpresion}) requiere una cantidad mayor que 0.`);
        }
        const cantidad = parseDecimalOrFail(c.cantidad, "V6", `en el ítem ${n}, el componente ${m} tiene una cantidad inválida.`);
        if (cantidad.lessThanOrEqualTo(0)) {
          throw new ValidationError(`V6: en el ítem ${n}, el componente ${m} (${c.modoExpresion}) requiere una cantidad mayor que 0.`);
        }
      } else if (c.cantidad !== null) {
        throw new ValidationError(`V7: en el ítem ${n}, el componente ${m} (${c.modoExpresion}) no debe tener cantidad.`);
      }
    });

    // V2
    const csp = item.componentes.filter((c) => c.modoExpresion === "CSP");
    if (csp.length > 1) {
      throw new ValidationError(`V2: el ítem ${n} tiene más de un componente csp (solo se permite uno).`);
    }

    // V3 -- "último orden" = último de la lista, en el orden en que el usuario los cargó.
    if (csp.length === 1 && item.componentes[item.componentes.length - 1]!.modoExpresion !== "CSP") {
      throw new ValidationError(`V3: en el ítem ${n}, el componente csp debe ser el último de la lista.`);
    }

    // V4 -- solo aplica a formas no capsulares (docs/specs/ficha-tecnica.md, aclaración de T3).
    const esCapsular = FORMAS_CAPSULARES.has(item.formaFarmaceutica);
    if (csp.length === 1 && !esCapsular && (item.cantidadTotal === null || item.unidadTotalId === null)) {
      throw new ValidationError(
        `V4: en el ítem ${n}, un componente csp en una forma no capsular requiere cargar la cantidad total y su unidad.`,
      );
    }
  });
}
