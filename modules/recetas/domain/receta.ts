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
 * FASE 1 point 1.10). V1/V2/V6/V7/V8/V9 are re-implemented here (cheap,
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
import { z } from "zod";
import { Decimal } from "@/shared/decimal";
import { ValidationError } from "@/shared/errors";
import type { FormaFarmaceutica, ModoExpresion } from "@/modules/elaboracion/domain/calcular-ficha-tecnica";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";

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

// Labels: shared/labels/enum-labels.ts (one map per enum, re-exported here for this module's callers).
export { FORMA_FARMACEUTICA_LABELS, ORIGEN_RECETA_LABELS } from "@/shared/labels/enum-labels";

const FORMAS_CAPSULARES: ReadonlySet<FormaFarmaceutica> = new Set(["CAPSULA", "COMPRIMIDO"]);

/** Capsular formas take a dose fraction per unit and fill their c.s.p. by volume, so they have no c.s.p. total. */
export function esFormaCapsular(forma: FormaFarmaceutica): boolean {
  return FORMAS_CAPSULARES.has(forma);
}

export type OrigenReceta = "PRESENCIAL" | "DIGITAL_PDF" | "DIGITAL_FOTO";
export const ORIGENES_RECETA = ["PRESENCIAL", "DIGITAL_PDF", "DIGITAL_FOTO"] as const satisfies readonly OrigenReceta[];

/**
 * DP-29 (docs/specs/importacion-receta-pdf.md): DIGITAL_PDF is enabled --
 * the PDF is read to prefill the receta and discarded, never stored, so
 * the receta carries the emisor's own number (`nroRecetaEmisor`) instead
 * of an attachment (migration 0049's `receta_adjunto_digital_check`).
 * DIGITAL_FOTO stays out of scope (no text layer, no OCR) and is rejected
 * with a clear message.
 */
export const ORIGENES_HABILITADOS: readonly OrigenReceta[] = ["PRESENCIAL", "DIGITAL_PDF"];

export const MENSAJE_ORIGEN_PENDIENTE =
  "El origen digital por foto todavía no está disponible. Registrá la receta como presencial o importá el PDF de la receta digital.";

export const MENSAJE_ORIGEN_DIGITAL_SOLO_IMPORTACION =
  "Las recetas digitales se cargan importando su PDF, no desde la carga manual.";

export const MENSAJE_ORIGEN_DIGITAL_NO_MODIFICABLE = "El origen de una receta digital no se puede cambiar.";

export function validarOrigenHabilitado(origen: OrigenReceta): void {
  if (!ORIGENES_HABILITADOS.includes(origen)) {
    throw new ValidationError(MENSAJE_ORIGEN_PENDIENTE);
  }
}

export function esOrigenDigital(origen: OrigenReceta): boolean {
  return origen === "DIGITAL_PDF" || origen === "DIGITAL_FOTO";
}

/**
 * Manual alta/edición (crearReceta/editarReceta). A digital receta only
 * comes from the PDF import, which is what sets `emisor`/`nroRecetaEmisor`
 * (without them the DB's `receta_adjunto_digital_check` would reject the
 * row). So by hand: alta is always PRESENCIAL, and an edit keeps whatever
 * origen the receta already has -- a digital receta never becomes
 * PRESENCIAL nor the other way around. `origenActual` is `null` for alta.
 */
export function validarOrigenCargaManual(origen: OrigenReceta, origenActual: OrigenReceta | null): void {
  validarOrigenHabilitado(origen);
  if (origen === origenActual) return;
  if (origenActual !== null && esOrigenDigital(origenActual)) {
    throw new ValidationError(MENSAJE_ORIGEN_DIGITAL_NO_MODIFICABLE);
  }
  if (esOrigenDigital(origen)) {
    throw new ValidationError(MENSAJE_ORIGEN_DIGITAL_SOLO_IMPORTACION);
  }
}

/** CIE-10 code, same pattern as migration 0049's `receta_diagnostico_codigo_check` (e.g. "E66.0"). */
export const DIAGNOSTICO_CODIGO_REGEX = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

/** Uppercases and trims a CIE-10 code as typed ("e66.0 " -> "E66.0"); validity is checked separately against `DIAGNOSTICO_CODIGO_REGEX`. */
export function normalizarDiagnosticoCodigo(codigo: string): string {
  return codigo.trim().toUpperCase();
}

export function esDiagnosticoCodigoValido(codigo: string): boolean {
  return DIAGNOSTICO_CODIGO_REGEX.test(codigo);
}

/** Optional CIE-10 code for crear/editar receta: empty -> `null`, otherwise normalized and format-checked. */
export const diagnosticoCodigoOpcional = z
  .string()
  .optional()
  .nullable()
  .transform((value, ctx) => {
    if (!value || value.trim().length === 0) return null;
    const codigo = normalizarDiagnosticoCodigo(value);
    if (!esDiagnosticoCodigoValido(codigo)) {
      ctx.addIssue({ code: "custom", message: "El código de diagnóstico debe tener formato CIE-10 (por ejemplo, E66.0)." });
      return z.NEVER;
    }
    return codigo;
  });

/** Optional treatment length in days: absent/`null` -> `null`; otherwise an integer > 0 (migration 0049's CHECK). */
export const duracionTratamientoDiasOpcional = z
  .number()
  .int("La duración del tratamiento debe ser un número entero de días.")
  .positive("La duración del tratamiento debe ser mayor que 0.")
  .optional()
  .nullable()
  .transform((v) => v ?? null);

export type EstadoReceta =
  | "PENDIENTE_PREPARACION"
  | "EN_PREPARACION"
  | "PREPARADA"
  | "ENVIADA_PEND_FIRMA"
  | "ENTREGADA"
  | "ANULADA";

export const ESTADOS_RECETA = [
  "PENDIENTE_PREPARACION",
  "EN_PREPARACION",
  "PREPARADA",
  "ENVIADA_PEND_FIRMA",
  "ENTREGADA",
  "ANULADA",
] as const satisfies readonly EstadoReceta[];

export const ESTADOS_TERMINALES: ReadonlySet<EstadoReceta> = new Set(["ENTREGADA", "ANULADA"]);

/** INV-R08. Mirrors fsj.receta_validar_transicion_estado exactly (migration 0011, last redefined by 0061). */
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

/**
 * Earliest `fechaPrescripcion` still accepted on `jornadaActual`: a receta
 * lasts one calendar month, so it is the same day one month back. When that
 * day does not exist in the previous month, the month's last day is used
 * (e.g. on 03-31 the limit is 02-28/29, so a receta from 02-28 or later is
 * accepted; on 03-01 the limit is 02-01).
 */
export function fechaPrescripcionMinima(jornadaActual: string): string {
  const [year, month, day] = jornadaActual.split("-").map(Number);
  const ultimoDiaMesAnterior = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 2, Math.min(day, ultimoDiaMesAnterior))).toISOString().slice(0, 10);
}

/** A receta prescribed more than one month before `jornadaActual` has expired. */
export function esFechaPrescripcionVigente(fechaPrescripcion: string, jornadaActual: string): boolean {
  return fechaPrescripcion >= fechaPrescripcionMinima(jornadaActual);
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
  /** Free-text dosage instruction (migration 0049). Informational only. */
  posologia?: string | null;
  /** Treatment length in days (migration 0049). When present, an integer > 0 (V-dur below). */
  duracionTratamientoDias?: number | null;
  /** The synonym of the droga it was picked by (migration 0069, display only); omitted/null = canonical name. */
  drogaAliasId?: string | null;
  componentes: ComponenteInput[];
}

/**
 * A V1-V9 rule violation (docs/specs/ficha-tecnica.md; V3 was removed with
 * the componentes' order, migration 0065). `regla` keeps the spec code for
 * tests and diagnostics; the user-facing message never includes it.
 */
export type ReglaReceta = "V1" | "V2" | "V4" | "V6" | "V7" | "V8" | "V9";

export class ReglaRecetaError extends ValidationError {
  readonly regla: ReglaReceta;

  constructor(regla: ReglaReceta, message: string) {
    super(message);
    this.regla = regla;
  }
}

function parseDecimalOrFail(value: string, regla: ReglaReceta, message: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new ReglaRecetaError(regla, message);
  }
  if (!parsed.isFinite()) {
    throw new ReglaRecetaError(regla, message);
  }
  return parsed;
}

/**
 * Validates a receta's full items/componentes tree BEFORE it reaches the
 * DB, mirroring migration 0011's CHECKs/deferred constraint triggers with
 * clear Spanish messages. Throws `ValidationError` on the FIRST violation
 * found (same "fail fast" posture as the DB's own non-deferred CHECKs).
 * The componentes of an item have no order (migration 0065), so none of
 * these rules depends on their position.
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
      throw new ReglaRecetaError("V9", `En el ítem ${n}, la cantidad de unidades debe ser un número entero mayor que 0.`);
    }

    // V8
    const fraccion = parseDecimalOrFail(
      item.fraccionDosisPorUnidad,
      "V8",
      `En el ítem ${n}, la fracción de dosis por unidad no es un número válido.`,
    );
    if (fraccion.lessThanOrEqualTo(0) || fraccion.greaterThan(1)) {
      throw new ReglaRecetaError("V8", `En el ítem ${n}, la fracción de dosis por unidad debe ser mayor que 0 y menor o igual a 1.`);
    }

    // Duración del tratamiento (migration 0049's item_receta_duracion_tratamiento_check). Not a
    // V1-V9 rule, so a plain ValidationError.
    if (item.duracionTratamientoDias !== undefined && item.duracionTratamientoDias !== null) {
      if (!Number.isInteger(item.duracionTratamientoDias) || item.duracionTratamientoDias <= 0) {
        throw new ValidationError(`En el ítem ${n}, la duración del tratamiento debe ser un número entero de días mayor que 0.`);
      }
    }

    // V1
    if (item.componentes.length === 0) {
      throw new ReglaRecetaError("V1", `El ítem ${n} debe tener al menos un componente.`);
    }

    // V6 / V7, per componente.
    item.componentes.forEach((c, compIdx) => {
      const m = compIdx + 1;
      const requiereCantidad = c.modoExpresion === "TOTAL" || c.modoExpresion === "POR_DOSIS";
      if (requiereCantidad) {
        if (c.cantidad === null) {
          throw new ReglaRecetaError("V6", `En el ítem ${n}, el componente ${m} (${c.modoExpresion}) requiere una cantidad mayor que 0.`);
        }
        const cantidad = parseDecimalOrFail(c.cantidad, "V6", `En el ítem ${n}, el componente ${m} tiene una cantidad inválida.`);
        if (cantidad.lessThanOrEqualTo(0)) {
          throw new ReglaRecetaError("V6", `En el ítem ${n}, el componente ${m} (${c.modoExpresion}) requiere una cantidad mayor que 0.`);
        }
      } else if (c.cantidad !== null) {
        throw new ReglaRecetaError("V7", `En el ítem ${n}, el componente ${m} (${c.modoExpresion}) no debe tener cantidad.`);
      }
    });

    // V2
    const csp = item.componentes.filter((c) => c.modoExpresion === "CSP");
    if (csp.length > 1) {
      throw new ReglaRecetaError("V2", `El ítem ${n} tiene más de un componente csp (solo se permite uno).`);
    }

    // V4 -- solo aplica a formas no capsulares (docs/specs/ficha-tecnica.md, aclaración de T3).
    const esCapsular = esFormaCapsular(item.formaFarmaceutica);
    if (csp.length === 1 && !esCapsular && (item.cantidadTotal === null || item.unidadTotalId === null)) {
      throw new ReglaRecetaError(
        "V4",
        `En el ítem ${n}, un componente csp en una forma no capsular requiere cargar la cantidad total y su unidad.`,
      );
    }
  });
}

// ============================================================================
// Readable item summary for the audit trail (M01): written next to the raw
// `items` payload so /auditoria can show "Cápsulas ×30: Ibuprofeno 200 mg
// por dosis + Lactosa c.s.p." instead of nested droga/unidad ids.
// ============================================================================

export interface NombresParaResumen {
  /** droga id -> nombre */
  drogas: ReadonlyMap<string, string>;
  /** unidad id -> símbolo */
  unidades: ReadonlyMap<string, string>;
}

function resumirComponente(c: ComponenteInput, nombres: NombresParaResumen): string {
  const nombre = nombres.drogas.get(c.drogaId) ?? "droga desconocida";
  const sinonimo = c.drogaAliasId ? nombres.sinonimos?.get(c.drogaAliasId) : undefined;
  const droga = sinonimo ? `${sinonimo} (${nombre})` : nombre;
  const unidad = nombres.unidades.get(c.unidadMedidaId) ?? "";
  if (c.modoExpresion === "CS") return `${droga} c.s.`;
  if (c.modoExpresion === "CSP") return `${droga} c.s.p.`;
  const cantidad = `${c.cantidad ?? ""} ${unidad}`.trim();
  return `${droga} ${cantidad}${c.modoExpresion === "POR_DOSIS" ? " por dosis" : ""}`;
}

/** One line per item: "Descripción (Forma) ×N: componente + componente". */
export function resumirItemsReceta(items: readonly ItemInput[], nombres: NombresParaResumen): string[] {
  return items.map((item) => {
    const forma = FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica] ?? item.formaFarmaceutica;
  /** droga_alias id -> texto, for componentes picked by a synonym: "Acetaminofén (Paracetamol) 500 mg". */
  sinonimos?: ReadonlyMap<string, string>;
    const titulo = item.descripcion ? `${item.descripcion} (${forma})` : forma;
    const total = item.cantidadTotal && item.unidadTotalId ? ` c.s.p. ${item.cantidadTotal} ${nombres.unidades.get(item.unidadTotalId) ?? ""}`.trimEnd() : "";
    return `${titulo} ×${item.cantidadUnidades}${total}: ${item.componentes.map((c) => resumirComponente(c, nombres)).join(" + ")}`;
  });
}
