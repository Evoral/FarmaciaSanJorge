/**
 * Existencia inicial / relevamiento inicial (openspec/specs/existencia-inicial/spec.md,
 * migration 0100, change openspec/changes/planilla-existencia-inicial/).
 * Pure: the window itself is computed in SQL
 * (`fsj.relevamiento_inicial_abierto`, the same function INV-S24 uses), so the
 * app and the DB can never disagree on it; this file holds what the UI, the
 * planilla and the use cases decide on top of it.
 */
import { dec, Decimal } from "@/shared/decimal";
import { formatFechaIso } from "@/shared/format/fecha";

/** `dias_relevamiento_inicial` default -- same fallback as `fsj.relevamiento_inicial_fecha_limite`. */
export const DIAS_RELEVAMIENTO_INICIAL_DEFAULT = "30";

/** Ceiling of `dias_relevamiento_inicial` (three months): existencia inicial is an onboarding door, not a standing one. Same cap in `fsj.relevamiento_inicial_fecha_limite`. */
export const DIAS_RELEVAMIENTO_INICIAL_MAX = 90;

export const MENSAJE_RELEVAMIENTO_CERRADO =
  "El relevamiento inicial está cerrado: ya no se puede cargar existencia inicial. Una diferencia de stock se corrige con un ajuste por diferencia de arqueo.";

export interface EstadoRelevamientoInicial {
  abierto: boolean;
  /** When the DT closed it, `null` when it was not closed by the DT (still open, or past its plazo). */
  cerradoEn: Date | null;
  cerradoPor: string | null;
  /** Last jornada of the plazo (YYYY-MM-DD), `null` while no cierre diario is signed. */
  fechaLimite: string | null;
}

/** One controlled droga at the close: its contralor saldo against its physical stock (spec R8). */
export interface SaldoControlada {
  drogaId: string;
  drogaNombre: string;
  unidadSimbolo: string;
  /** Latest vigente asiento's `saldo_posterior` in its open libro; `null` = no APERTURA yet. */
  saldoContralor: string | null;
  /** Sum of `cantidad_disponible` of all its partidas. */
  stockFisico: string;
}

/** The controlled drogas whose contralor saldo (no APERTURA = 0) differs from their physical stock. */
export function diferenciasControladas(saldos: readonly SaldoControlada[]): SaldoControlada[] {
  return saldos.filter((s) => !dec(s.saldoContralor ?? "0").equals(dec(s.stockFisico)));
}

// ============================================================================
// Planilla de existencia inicial: pure domain (R13, R14, R15)
// ============================================================================

export interface FilaPlanillaInput {
  id: string;
  drogaId?: string | null;
  lote?: string | null;
  fechaVencimiento?: string | null;
  cantidad?: string | null;
  unidadMedidaId?: string | null;
  potenciaDeclarada?: string | null;
  costoUnitario?: string | null;
  proveedorId?: string | null;
  textoDroga?: string | null;
}

export interface DrogaContexto {
  id: string;
  nombre: string;
  clase: "DROGA" | "EXCIPIENTE" | "MATERIAL";
  unidadBaseId: string;
}

export interface PartidaExistenteContexto {
  id: string;
  drogaId: string;
  lote: string;
  proveedorId: string | null;
  origen: "COMPRA" | "EXISTENCIA_INICIAL" | "ELABORACION_PROPIA";
  fechaVencimiento: string | null;
  potenciaDeclarada: string | null;
  costoUnitario: string | null;
}

export type TipoEstadoFila = "lista" | "incompleta" | "se_suma" | "en_conflicto";

export interface EstadoFilaResultado {
  tipo: TipoEstadoFila;
  campoFaltante?: string;
  diferencia?: string;
  motivo?: string;
}

/**
 * Checks which required field is missing from a row (R3, R14).
 * Returns null if the row has all required data.
 */
export function campoFaltanteFila(
  fila: FilaPlanillaInput,
  droga?: DrogaContexto | null,
  factorABase?: Map<string, Decimal | null | undefined> | ((unidadMedidaId: string) => Decimal | null | undefined) | null,
): { campo: string; motivo: string } | null {
  if (!fila.drogaId || fila.drogaId.trim() === "") {
    return { campo: "droga", motivo: "Falta la droga" };
  }
  if (!fila.lote || fila.lote.trim() === "") {
    return { campo: "lote", motivo: "Falta el lote" };
  }
  if (!fila.cantidad || fila.cantidad.trim() === "") {
    return { campo: "cantidad", motivo: "Falta la cantidad" };
  }
  try {
    if (dec(fila.cantidad).lte(0)) {
      return { campo: "cantidad", motivo: "La cantidad debe ser mayor a 0" };
    }
  } catch {
    return { campo: "cantidad", motivo: "Cantidad inválida" };
  }
  if (!fila.unidadMedidaId || fila.unidadMedidaId.trim() === "") {
    return { campo: "unidad", motivo: "Falta la unidad de medida" };
  }
  if (factorABase) {
    const rawFactor = typeof factorABase === "function" ? factorABase(fila.unidadMedidaId) : factorABase.get(fila.unidadMedidaId);
    if (!rawFactor || dec(rawFactor).lte(0)) {
      return { campo: "unidad", motivo: "La unidad no tiene factor de conversión o es de otra magnitud" };
    }
  }
  // Fecha de vencimiento is required for clase DROGA, optional for insumos (R3)
  if (droga && droga.clase === "DROGA" && (!fila.fechaVencimiento || fila.fechaVencimiento.trim() === "")) {
    return { campo: "vencimiento", motivo: "Falta la fecha de vencimiento" };
  }

  return null;
}

export function esFilaCompleta(
  fila: FilaPlanillaInput,
  droga?: DrogaContexto | null,
  factorABase?: Map<string, Decimal | null | undefined> | ((unidadMedidaId: string) => Decimal | null | undefined) | null,
): boolean {
  return campoFaltanteFila(fila, droga, factorABase) === null;
}

export function claveGrupo(drogaId: string, lote: string, proveedorId: string | null | undefined): string {
  return `${drogaId}::${lote.trim()}::${proveedorId ?? ""}`;
}

/**
 * Evaluates conflicts for a group of rows against other rows in the group and against
 * any existing partida in stock (R15).
 * A blank potencia or costo is not a difference.
 */
export function conflictosGrupo(
  filas: readonly FilaPlanillaInput[],
  partidaExistente?: PartidaExistenteContexto | null,
): string[] {
  const conflictos: string[] = [];

  if (partidaExistente) {
    if (partidaExistente.origen !== "EXISTENCIA_INICIAL") {
      if (partidaExistente.origen === "COMPRA") {
        conflictos.push("Ese lote ya ingresó como compra");
      } else if (partidaExistente.origen === "ELABORACION_PROPIA") {
        conflictos.push("Ese lote ya existe como lote elaborado en la farmacia");
      } else {
        conflictos.push("Ese lote ya existe con otro origen en el stock");
      }
      return conflictos;
    }

    const vp = partidaExistente.fechaVencimiento?.trim() || null;

    // Compare with existing partida
    for (const f of filas) {
      const vf = f.fechaVencimiento?.trim() || null;
      if (vf !== vp) {
        const descF = vf ? formatFechaIso(vf) : "no vence";
        const descP = vp ? formatFechaIso(vp) : "no vence";
        const msg = `La fecha de vencimiento (${descF}) difiere de la partida en stock (${descP})`;
        if (!conflictos.includes(msg)) conflictos.push(msg);
      }

      if (
        f.potenciaDeclarada &&
        f.potenciaDeclarada.trim() !== "" &&
        partidaExistente.potenciaDeclarada &&
        partidaExistente.potenciaDeclarada.trim() !== ""
      ) {
        if (!dec(f.potenciaDeclarada).equals(dec(partidaExistente.potenciaDeclarada))) {
          const msg = `La potencia declarada (${f.potenciaDeclarada}%) difiere de la partida en stock (${partidaExistente.potenciaDeclarada}%)`;
          if (!conflictos.includes(msg)) conflictos.push(msg);
        }
      }

      if (
        f.costoUnitario &&
        f.costoUnitario.trim() !== "" &&
        partidaExistente.costoUnitario &&
        partidaExistente.costoUnitario.trim() !== ""
      ) {
        if (!dec(f.costoUnitario).equals(dec(partidaExistente.costoUnitario))) {
          const msg = `El costo unitario ($${f.costoUnitario}) difiere de la partida en stock ($${partidaExistente.costoUnitario})`;
          if (!conflictos.includes(msg)) conflictos.push(msg);
        }
      }
    }
  }

  // Compare rows within the group with each other
  for (let i = 0; i < filas.length; i++) {
    for (let j = i + 1; j < filas.length; j++) {
      const f1 = filas[i]!;
      const f2 = filas[j]!;

      const v1 = f1.fechaVencimiento?.trim() || null;
      const v2 = f2.fechaVencimiento?.trim() || null;
      if (v1 !== v2) {
        const desc1 = v1 ? formatFechaIso(v1) : "no vence";
        const desc2 = v2 ? formatFechaIso(v2) : "no vence";
        const msg = `Diferente vencimiento en el mismo lote (${desc1} vs ${desc2})`;
        if (!conflictos.includes(msg)) conflictos.push(msg);
      }

      if (
        f1.potenciaDeclarada &&
        f1.potenciaDeclarada.trim() !== "" &&
        f2.potenciaDeclarada &&
        f2.potenciaDeclarada.trim() !== ""
      ) {
        if (!dec(f1.potenciaDeclarada).equals(dec(f2.potenciaDeclarada))) {
          const msg = `Diferente potencia declarada en el mismo lote (${f1.potenciaDeclarada}% vs ${f2.potenciaDeclarada}%)`;
          if (!conflictos.includes(msg)) conflictos.push(msg);
        }
      }

      if (
        f1.costoUnitario &&
        f1.costoUnitario.trim() !== "" &&
        f2.costoUnitario &&
        f2.costoUnitario.trim() !== ""
      ) {
        if (!dec(f1.costoUnitario).equals(dec(f2.costoUnitario))) {
          const msg = `Diferente costo unitario en el mismo lote ($${f1.costoUnitario} vs $${f2.costoUnitario})`;
          if (!conflictos.includes(msg)) conflictos.push(msg);
        }
      }
    }
  }

  return conflictos;
}

/**
 * Determines the state of a single row in the planilla (R14):
 * - lista: complete and ready to pass
 * - incompleta: missing a required field (names what is missing)
 * - se_suma: complete and sums to another row or to a partida already in stock
 * - en_conflicto: complete but conflicts with sibling rows or existing partida
 */
export function estadoFila(
  fila: FilaPlanillaInput,
  contexto: {
    droga?: DrogaContexto | null;
    filasDelGrupo?: readonly FilaPlanillaInput[];
    partidaExistente?: PartidaExistenteContexto | null;
    factorABase?: Map<string, Decimal | null | undefined> | ((unidadMedidaId: string) => Decimal | null | undefined) | null;
  },
): EstadoFilaResultado {
  const faltante = campoFaltanteFila(fila, contexto.droga, contexto.factorABase);
  if (faltante) {
    return {
      tipo: "incompleta",
      campoFaltante: faltante.campo,
      motivo: faltante.motivo,
    };
  }

  const filasGrupo = (contexto.filasDelGrupo && contexto.filasDelGrupo.length > 0)
    ? contexto.filasDelGrupo
    : [fila];

  const conflictos = conflictosGrupo(filasGrupo, contexto.partidaExistente);
  if (conflictos.length > 0) {
    return {
      tipo: "en_conflicto",
      diferencia: conflictos[0],
      motivo: conflictos.join("; "),
    };
  }

  const completeRowsInGroup = filasGrupo.filter((f) => esFilaCompleta(f, contexto.droga, contexto.factorABase));
  if (completeRowsInGroup.length > 1 || Boolean(contexto.partidaExistente)) {
    return {
      tipo: "se_suma",
      motivo: contexto.partidaExistente ? "Se suma a partida en stock" : "Se suma a otra fila",
    };
  }

  return {
    tipo: "lista",
    motivo: "Lista para pasar a stock",
  };
}

// ============================================================================
// Corrections: pure domain (R17, R18)
// ============================================================================

export type TipoDeltaCorreccion = "SUMA" | "RESTA" | null;

export interface DeltaCorreccionResultado {
  tipo: TipoDeltaCorreccion;
  cantidad: Decimal;
}

/**
 * Computes the delta between current initial quantity and corrected initial quantity (R17).
 * Returns { tipo: "SUMA" | "RESTA" | null, cantidad: Decimal }.
 * Uses decimal.js, never JS numbers.
 */
export function deltaCorreccion(
  cantidadInicialActual: string | Decimal,
  cantidadCorrecta: string | Decimal,
): DeltaCorreccionResultado {
  const actual = dec(cantidadInicialActual);
  const correcta = dec(cantidadCorrecta);

  if (correcta.greaterThan(actual)) {
    return {
      tipo: "SUMA",
      cantidad: correcta.minus(actual),
    };
  }

  if (correcta.lessThan(actual)) {
    return {
      tipo: "RESTA",
      cantidad: actual.minus(correcta),
    };
  }

  return {
    tipo: null,
    cantidad: new Decimal(0),
  };
}

export interface PartidaUsoContexto {
  fechaApertura: Date | string | null;
  tieneMovimientosNoIniciales: boolean;
  tieneReservasActivas: boolean;
  tieneReanalisis: boolean;
}

/**
 * An existencia inicial partida is unused (R18) only while:
 * - fecha_apertura IS NULL
 * - no movimiento_stock other than INGRESO_INICIAL, CORRECCION_INICIAL_SUMA, CORRECCION_INICIAL_RESTA
 * - no active reserva_stock in an INICIADA preparación
 * - no reanalisis_partida records
 * Once used, its lote, vencimiento and proveedor are frozen.
 */
export function esPartidaNoUsada(contexto: PartidaUsoContexto): boolean {
  if (contexto.fechaApertura !== null && contexto.fechaApertura !== undefined) return false;
  if (contexto.tieneMovimientosNoIniciales) return false;
  if (contexto.tieneReservasActivas) return false;
  if (contexto.tieneReanalisis) return false;
  return true;
}

