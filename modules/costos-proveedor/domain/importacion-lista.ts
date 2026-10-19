/**
 * Preview of a supplier price list import (docs/specs/costos-proveedor.md R13, R17-R19). PURE: no
 * I/O, no Prisma. Shared by the server (`leerListaPrecios` builds the first preview) and the
 * browser (`importar-lista-form.tsx` re-evaluates every row the moment the user picks another
 * droga, edits a price, changes a unit or omits a row), so both sides apply EXACTLY the same rules.
 *
 * Row states (R18), in precedence order -- the first that applies wins:
 *   1. OMITIDA_PRESENTACION: the description ends in a presentation (R16); never imported.
 *   2. OMITIDA: the user left the row out.
 *   3. SIN_ASOCIAR: no droga yet (nothing matched, none picked); left out unless the user picks one.
 *   4. DUPLICADA: the same droga is on another row that is still in; ALL of the group are flagged
 *      and the user must omit all but one (CP7). Blocks the confirmation.
 *   5. PRECIO_INVALIDO: no price, not a number, <= 0, a unit that does not fit the droga or a cost
 *      that rounds to zero. Blocks the confirmation.
 *   6. MAS_ANTIGUA: the vigente has a LATER fecha_precio than the list (R9). Not applied, not blocking.
 *   7. SIN_CAMBIOS: same price, unit and date as the vigente (R10). Not applied, not blocking.
 *   8. ASOCIADA: will be applied (new costo or a new version of the vigente).
 *
 * Only ASOCIADA rows are sent on confirm; the command checks everything again (R20, R23).
 */
import { Decimal, dec } from "@/shared/decimal";
import { formatFechaIso } from "@/shared/format/fecha";
import { resolverDroga } from "@/modules/recetas/domain/importacion-receta";
import type { AliasDroga, ViaMatchDroga } from "@/modules/recetas/domain/importacion-receta";
import { detectarDuplicados, esFechaIsoReal, planVersionar, unidadPrecioPorDefecto, validarFilaCosto } from "./costo-proveedor";
import type { TipoMagnitudCosto, UnidadParaCosto } from "./costo-proveedor";
import type { FormatoLista } from "./archivo-lista";
import type { FilaListaLeida } from "./parsers/lista-xlsx-crystal";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";

export const ESTADOS_FILA_LISTA = ["ASOCIADA", "SIN_ASOCIAR", "DUPLICADA", "PRECIO_INVALIDO", "MAS_ANTIGUA", "SIN_CAMBIOS", "OMITIDA_PRESENTACION", "OMITIDA"] as const;
export type EstadoFilaLista = (typeof ESTADOS_FILA_LISTA)[number];

export const ESTADO_FILA_LISTA_LABELS: Readonly<Record<EstadoFilaLista, string>> = {
  ASOCIADA: "Asociada",
  SIN_ASOCIAR: "Sin asociar",
  DUPLICADA: "Duplicada",
  PRECIO_INVALIDO: "Precio inválido",
  MAS_ANTIGUA: "Más antigua",
  SIN_CAMBIOS: "Sin cambios",
  OMITIDA_PRESENTACION: "Omitida (presentación)",
  OMITIDA: "Omitida",
};

/** R18: a variation above this (in either direction) is highlighted. */
export const VARIACION_ALTA_PORCENTAJE = 50;

/** States that stop the confirmation until the user resolves them (R18, CP7). */
export const ESTADOS_QUE_BLOQUEAN: readonly EstadoFilaLista[] = ["DUPLICADA", "PRECIO_INVALIDO"];

// ============================================================================
// What the evaluation needs (the catalogs, as plain data)
// ============================================================================

export interface DrogaParaLista {
  id: string;
  nombre: string;
  tipoMagnitud: string;
  unidadBaseId: string;
}

export interface UnidadParaLista {
  id: string;
  codigo: string;
  simbolo: string;
  tipoMagnitud: string;
  /** `factor_a_base` as a decimal string. */
  factorABase: string;
  /** `false` = dada de baja: never offered. */
  vigente: boolean;
}

/** The vigente costo of a (droga, this proveedor) pair as the preview compares against (R18, R23). */
export interface VigenteParaLista {
  id: string;
  drogaId: string;
  precioInformado: string;
  unidadPrecioId: string;
  unidadPrecioSimbolo: string;
  /** Per the droga's unidad base. */
  costoUnitario: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
}

export interface ContextoEvaluacionLista {
  /** `YYYY-MM-DD`: every row of the import is dated with it (R3, R13). */
  fechaLista: string;
  drogas: ReadonlyMap<string, DrogaParaLista>;
  unidades: ReadonlyMap<string, UnidadParaLista>;
  vigentePorDroga: ReadonlyMap<string, VigenteParaLista>;
}

/** What each row currently holds (the server's match at first, then the user's edits). */
export interface EntradaFilaLista {
  drogaId: string | null;
  /** The price as typed (plain decimal, or es-AR with a comma): see `parsearPrecioIngresado`. */
  precio: string | null;
  unidadPrecioId: string | null;
  omitida: boolean;
  /** The presentation suffix of the description (R16); a row with one is never imported. */
  presentacion: string | null;
}

export interface EvaluacionFilaLista {
  estado: EstadoFilaLista;
  /** The canonical price when it parsed (also when the row is not valid for another reason). */
  precioCanonico: string | null;
  /** Per the droga's unidad base, when droga, price and unit are consistent. */
  costoUnitario: string | null;
  /** `(nuevo - vigente) / vigente * 100`, 1 decimal, on the cost per unidad base (so a change of unit compares right); `null` with no vigente or no valid cost. */
  variacionPct: string | null;
  /** |variación| > 50 % (R18). */
  variacionAlta: boolean;
  /** Why the row is in `PRECIO_INVALIDO` / `MAS_ANTIGUA`, for the user. */
  mensaje: string | null;
}

// ============================================================================
// The list's own fields
// ============================================================================

/** R8 applied to the list's date (every row is dated with it): a real calendar day, not after the jornada. `null` when it is fine. */
export function mensajeFechaListaInvalida(fechaLista: string, jornadaActual: string): string | null {
  if (!esFechaIsoReal(fechaLista)) return "La fecha de la lista debe ser una fecha válida.";
  if (fechaLista > jornadaActual) return "La fecha de la lista no puede ser posterior a hoy.";
  return null;
}

/** R21. `fecha` is the day the list was imported, already formatted for the user. */
export function mensajeListaYaImportada(fecha: string): string {
  return `Esta lista ya fue importada para este proveedor el ${fecha}.`;
}

/** The sheet the preview opens with: the LAST one that has data (the workbook has one sheet per date, newest last), or `null` when every sheet is empty. */
export function hojaPorDefecto(hojas: readonly HojaLibro[]): string | null {
  for (let i = hojas.length - 1; i >= 0; i--) if (!hojas[i]!.vacia) return hojas[i]!.nombre;
  return null;
}

// ============================================================================
// Price typed by the user
// ============================================================================

/**
 * A price as the user types it (an optional "$"), to a canonical plain decimal string -- read like every typed number
 * (`interpretarNumero`: comma decimals, es-AR thousands, an ambiguous "1.125" refused; the preview prefills with a
 * comma, so it reads back unchanged). `null` when it is not a non-negative number; `mensajePrecioIngresado` says why.
 */
export function parsearPrecioIngresado(texto: string | null | undefined): string | null {
  const numero = interpretarNumero(sinSimboloPeso(texto));
  return numero.ok && !numero.valor.startsWith("-") ? dec(numero.valor).toFixed() : null;
}

/** Why a typed price is not one (the ambiguity, a bad format, empty). */
export function mensajePrecioIngresado(texto: string | null | undefined): string {
  const numero = interpretarNumero(sinSimboloPeso(texto));
  return numero.ok ? "El precio debe ser mayor a cero." : numero.mensaje;
}

function sinSimboloPeso(texto: string | null | undefined): string {
  return (texto ?? "").trim().replace(/^\$\s*/, "");
}

// ============================================================================
// Row evaluation
// ============================================================================

/** The units of the catalog as `validarFilaCosto` wants them. Bajas are told apart by a non-null `fechaBaja`; its value is irrelevant. */
const FECHA_BAJA_CUALQUIERA = new Date(0);

function aUnidadParaCosto(unidad: UnidadParaLista): UnidadParaCosto {
  return { id: unidad.id, codigo: unidad.codigo, factorABase: unidad.factorABase, tipoMagnitud: unidad.tipoMagnitud, fechaBaja: unidad.vigente ? null : FECHA_BAJA_CUALQUIERA };
}

function variacionDe(costoNuevo: string, costoVigente: string): { pct: string; alta: boolean } | null {
  const anterior = dec(costoVigente);
  if (!anterior.greaterThan(0)) return null;
  const variacion = dec(costoNuevo).minus(anterior).dividedBy(anterior).times(100);
  return { pct: variacion.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1), alta: variacion.abs().greaterThan(VARIACION_ALTA_PORCENTAJE) };
}

/** What the price, unit and droga of one row amount to: the canonical price and cost, or why not. */
function evaluarPrecio(
  contexto: ContextoEvaluacionLista,
  entrada: EntradaFilaLista,
  droga: DrogaParaLista,
): { precio: string | null; costoUnitario: string | null; mensaje: string | null } {
  const precio = parsearPrecioIngresado(entrada.precio);
  if (precio === null) return { precio, costoUnitario: null, mensaje: mensajePrecioIngresado(entrada.precio) };
  if (!dec(precio).greaterThan(0)) return { precio, costoUnitario: null, mensaje: "El precio debe ser mayor a cero." };
  const unidadPrecio = entrada.unidadPrecioId ? contexto.unidades.get(entrada.unidadPrecioId) : undefined;
  if (!unidadPrecio) return { precio, costoUnitario: null, mensaje: "Elegí la unidad del precio." };
  const unidadBase = contexto.unidades.get(droga.unidadBaseId);
  if (!unidadBase) return { precio, costoUnitario: null, mensaje: "La droga no tiene una unidad base conocida." };
  const validacion = validarFilaCosto({ precioInformado: precio, unidadPrecio: aUnidadParaCosto(unidadPrecio), unidadBase });
  if (!validacion.ok) return { precio, costoUnitario: null, mensaje: validacion.mensaje };
  return { precio, costoUnitario: validacion.costoUnitario, mensaje: null };
}

/**
 * The state of every row (see the module doc comment for the precedence), plus the price / variation
 * each one shows. Same length and order as `entradas`.
 */
export function evaluarFilasLista(contexto: ContextoEvaluacionLista, entradas: readonly EntradaFilaLista[]): EvaluacionFilaLista[] {
  const drogaDe = (entrada: EntradaFilaLista) => (entrada.drogaId ? contexto.drogas.get(entrada.drogaId) : undefined);
  const enJuego = (entrada: EntradaFilaLista) => entrada.presentacion === null && !entrada.omitida && drogaDe(entrada) !== undefined;
  const duplicadas = new Set(detectarDuplicados(entradas.map((entrada) => ({ drogaId: enJuego(entrada) ? entrada.drogaId : null }))));

  return entradas.map((entrada, indice): EvaluacionFilaLista => {
    const base = { precioCanonico: null, costoUnitario: null, variacionPct: null, variacionAlta: false, mensaje: null };
    if (entrada.presentacion !== null) return { ...base, estado: "OMITIDA_PRESENTACION" };
    if (entrada.omitida) return { ...base, estado: "OMITIDA" };
    const droga = drogaDe(entrada);
    if (!droga) return { ...base, estado: "SIN_ASOCIAR" };

    const { precio, costoUnitario, mensaje } = evaluarPrecio(contexto, entrada, droga);
    const vigente = contexto.vigentePorDroga.get(droga.id) ?? null;
    const variacion = costoUnitario !== null && vigente ? variacionDe(costoUnitario, vigente.costoUnitario) : null;
    const resultado = { precioCanonico: precio, costoUnitario, variacionPct: variacion?.pct ?? null, variacionAlta: variacion?.alta ?? false, mensaje };

    if (duplicadas.has(indice)) return { ...resultado, estado: "DUPLICADA", mensaje: "La droga está en más de una fila de la lista: dejá solo una." };
    if (costoUnitario === null || precio === null || !entrada.unidadPrecioId) return { ...resultado, estado: "PRECIO_INVALIDO" };

    const plan = planVersionar({
      vigente: vigente ? { id: vigente.id, precioInformado: vigente.precioInformado, unidadPrecioId: vigente.unidadPrecioId, fechaPrecio: vigente.fechaPrecio } : null,
      nuevo: { precioInformado: precio, unidadPrecioId: entrada.unidadPrecioId, fechaPrecio: contexto.fechaLista },
    });
    if (plan.tipo === "RECHAZAR") {
      return { ...resultado, estado: "MAS_ANTIGUA", mensaje: `Ya hay un precio de este proveedor con fecha ${formatFechaIso(vigente!.fechaPrecio)}, más nuevo que la lista.` };
    }
    if (plan.tipo === "SIN_CAMBIOS") return { ...resultado, estado: "SIN_CAMBIOS" };
    return { ...resultado, estado: "ASOCIADA" };
  });
}

export type ResumenEstados = Readonly<Record<EstadoFilaLista, number>>;

export function resumirEstados(evaluaciones: readonly Pick<EvaluacionFilaLista, "estado">[]): ResumenEstados {
  const resumen = Object.fromEntries(ESTADOS_FILA_LISTA.map((estado) => [estado, 0])) as Record<EstadoFilaLista, number>;
  for (const evaluacion of evaluaciones) resumen[evaluacion.estado] += 1;
  return resumen;
}

// ============================================================================
// The preview the read step hands to the form
// ============================================================================

export interface FilaVistaPreviaLista {
  numeroFila: number;
  descripcion: string;
  /** The price as read (canonical decimal), `null` when missing or not a number. */
  precio: string | null;
  presentacion: string | null;
  drogaId: string | null;
  drogaNombre: string | null;
  via: ViaMatchDroga | null;
  /** R6: the default unidad de precio of the matched droga's magnitud, `null` while there is no droga. */
  unidadPrecioId: string | null;
  /** The vigente costo of the matched droga for this proveedor. */
  vigente: VigenteParaLista | null;
  estado: EstadoFilaLista;
  variacionPct: string | null;
  variacionAlta: boolean;
  mensaje: string | null;
}

export interface HojaLibro {
  nombre: string;
  vacia: boolean;
}

export interface VistaPreviaLista {
  proveedor: { id: string; razonSocial: string };
  /** `YYYY-MM-DD`. */
  fechaLista: string;
  nombreArchivo: string;
  hashSha256: string;
  formato: FormatoLista;
  hojas: HojaLibro[];
  /** The sheet this preview was read from. */
  hoja: string;
  /** Data rows read from the sheet (presentation rows included): what `lista_precio_proveedor.filas_leidas` records. */
  filasLeidas: number;
  /** Non-blank rows that are not data (footers, `COSTO PREPARACION`...). */
  descartadas: number;
  filas: FilaVistaPreviaLista[];
  /** Every vigente costo of the proveedor: the browser re-evaluates a row against the droga the user picks. */
  vigentes: VigenteParaLista[];
  resumen: ResumenEstados;
}

/** The unidad de precio a droga starts with (R6): the default unidad of its magnitud, when the catalog has it vigente. */
export function unidadPrecioInicial(tipoMagnitud: string, unidades: readonly UnidadParaLista[]): string | null {
  const codigo = unidadPrecioPorDefecto(tipoMagnitud as TipoMagnitudCosto);
  return unidades.find((u) => u.vigente && u.tipoMagnitud === tipoMagnitud && u.codigo === codigo)?.id ?? null;
}

export interface EntradaVistaPrevia {
  filas: readonly FilaListaLeida[];
  /** Vigente drogas only (R12). */
  drogas: readonly DrogaParaLista[];
  /** Remembered synonyms of vigente drogas, already restricted to the texts of the file (R17). */
  aliases: readonly AliasDroga[];
  unidades: readonly UnidadParaLista[];
  /** Vigente costos of THIS proveedor. */
  vigentes: readonly VigenteParaLista[];
  fechaLista: string;
}

/**
 * R17 + R18: matches every parsed row (remembered synonym first, then exact normalized name -- the
 * same `resolverDroga` as the receta and invoice imports; no fuzzy match, no droga is created) and
 * evaluates it. Returns the rows and the count per state.
 */
export function construirVistaPrevia(entrada: EntradaVistaPrevia): Pick<VistaPreviaLista, "filas" | "resumen"> {
  const drogas = new Map(entrada.drogas.map((droga) => [droga.id, droga]));
  const unidades = new Map(entrada.unidades.map((unidad) => [unidad.id, unidad]));
  const vigentePorDroga = new Map(entrada.vigentes.map((vigente) => [vigente.drogaId, vigente]));
  const contexto: ContextoEvaluacionLista = { fechaLista: entrada.fechaLista, drogas, unidades, vigentePorDroga };

  const candidatas = entrada.drogas.map((droga) => ({ id: droga.id, nombre: droga.nombre }));
  const emparejadas = entrada.filas.map((fila) => {
    // A presentation row is never imported: no point matching it.
    const match = fila.presentacion === null ? resolverDroga(fila.descripcion, entrada.aliases, candidatas) : null;
    const droga = match ? drogas.get(match.drogaId) : undefined;
    return { fila, match, droga };
  });

  const entradas: EntradaFilaLista[] = emparejadas.map(({ fila, droga }) => ({
    drogaId: droga?.id ?? null,
    precio: fila.precio,
    unidadPrecioId: droga ? unidadPrecioInicial(droga.tipoMagnitud, entrada.unidades) : null,
    omitida: false,
    presentacion: fila.presentacion,
  }));
  const evaluaciones = evaluarFilasLista(contexto, entradas);

  const filas = emparejadas.map(({ fila, match, droga }, indice): FilaVistaPreviaLista => {
    const evaluacion = evaluaciones[indice]!;
    return {
      numeroFila: fila.numeroFila,
      descripcion: fila.descripcion,
      precio: fila.precio,
      presentacion: fila.presentacion,
      drogaId: droga?.id ?? null,
      drogaNombre: droga?.nombre ?? null,
      via: droga ? (match?.via ?? null) : null,
      unidadPrecioId: entradas[indice]!.unidadPrecioId,
      vigente: droga ? (vigentePorDroga.get(droga.id) ?? null) : null,
      estado: evaluacion.estado,
      variacionPct: evaluacion.variacionPct,
      variacionAlta: evaluacion.variacionAlta,
      mensaje: evaluacion.mensaje,
    };
  });
  return { filas, resumen: resumirEstados(evaluaciones) };
}
