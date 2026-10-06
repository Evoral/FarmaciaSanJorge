/**
 * Digital receta PDF parser (docs/specs/importacion-receta-pdf.md, "Pieza 2").
 * PURE: receives the PDF's positioned text items and its link URIs (already
 * extracted by the infrastructure layer) and returns a draft (`borrador`)
 * plus warnings. No I/O, no PDF library, no runtime dependencies -- tested
 * with hand-built synthetic items, never with binary PDFs.
 *
 * Pipeline:
 *   1. Items -> visual rows (`agruparRenglones`): grouped by vertical
 *      proximity with tolerance `max(2, medianHeight * 0.6)`, sorted by x
 *      and joined with a space. Each row is also split into horizontal
 *      segments at large gaps, because a receta's header has two columns on
 *      the same visual line ("MÉDICO - MEDICINA GENERAL ... Creada: dd/mm").
 *   2. Emisor detection (`ESTRATEGIAS_EMISOR`): the emisor's logo is an
 *      image, so it is detected by its verification link host or its
 *      registry number (`RL-AAAA-NNNNNNNNN`). Unknown emisor -> "formato
 *      no reconocido", nothing is prefilled. Each emisor is its own
 *      strategy with its own tests.
 *   3. The emisor's strategy extracts header fields and classifies each
 *      line of the `Rp./` body (componente / presentación / fracción /
 *      posología / duración / otro), then runs the consistency check
 *      (units vs. treatment length -- a warning, never a block).
 *
 * Matching the draft against existing pacientes/médicos/drogas/unidades
 * is NOT done here (that is the application layer's match step).
 */
import type { FormaFarmaceutica } from "./receta";
import { normalizarTexto } from "./normalizar";

// ============================================================================
// Input / output types
// ============================================================================

/**
 * One positioned text fragment of a PDF page. Coordinate convention: PDF
 * points, origin at the page's TOP-LEFT corner, `y` growing DOWNWARD;
 * (`x`, `y`) is the fragment's top-left corner. pdf.js/unpdf report a
 * bottom-left origin with a baseline transform -- the extraction layer
 * converts to this convention before calling the parser.
 */
export interface TextItemLite {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A link annotation of the document (only its target matters here). */
export interface LinkLite {
  uri: string;
}

export interface RecetaPdfInput {
  /** One array of items per page, in page order. */
  pages: TextItemLite[][];
  links: LinkLite[];
}

export const CODIGOS_EMISOR = ["RCTA"] as const;
export type CodigoEmisor = (typeof CODIGOS_EMISOR)[number];

export type JurisdiccionMatriculaPdf = "NACIONAL" | "PROVINCIAL";

/**
 * A full name split into nombre/apellido: with 2 words the last one is the
 * apellido; with 3+ words the last one is still taken as apellido (best
 * effort) and `requiereConfirmacion` asks the preview to have the user
 * confirm the split (spec, "Separación de nombres").
 */
export interface NombreSeparado {
  nombreCompleto: string;
  nombre: string;
  apellido: string;
  requiereConfirmacion: boolean;
}

export interface BorradorPaciente {
  nombre: NombreSeparado | null;
  dni: string | null;
  cuil: string | null;
  sexo: string | null;
  /** ISO `YYYY-MM-DD`. */
  fechaNacimiento: string | null;
  nroCredencial: string | null;
}

export interface BorradorMedico {
  nombre: NombreSeparado | null;
  especialidad: string | null;
  matricula: string | null;
  matriculaJurisdiccion: JurisdiccionMatriculaPdf | null;
  direccionRegistrada: string | null;
  telefono: string | null;
}

export interface BorradorComponente {
  /** Drug name as printed -- resolved to a droga by the match step. */
  drogaTexto: string;
  /** Decimal string with a dot (es-AR "0,3" -> "0.3"). */
  cantidad: string;
  /** Unit as printed ("mg", "UI", "%") -- resolved to a unidad by the match step. */
  unidadTexto: string;
  /** The dose printed on the receta is the full dose (spec, "Reglas del ítem"). */
  modoExpresion: "POR_DOSIS";
}

export interface BorradorItem {
  formaFarmaceutica: FormaFarmaceutica | null;
  cantidadUnidades: number | null;
  /** Decimal string: "1" unless the receta says "media dosis" / "½ dosis" ("0.5", docs/specs/ficha-tecnica.md). */
  fraccionDosisPorUnidad: string;
  posologia: string | null;
  duracionTratamientoDias: number | null;
  componentes: BorradorComponente[];
}

export interface BorradorReceta {
  emisor: CodigoEmisor;
  nroRecetaEmisor: string;
  urlVerificacion: string | null;
  /** ISO `YYYY-MM-DD` ("Creada:"). */
  fechaPrescripcion: string | null;
  /** ISO `YYYY-MM-DD` ("Válida desde:"). */
  fechaValidaDesde: string | null;
  diagnosticoCodigo: string | null;
  diagnosticoDescripcion: string | null;
  paciente: BorradorPaciente;
  medico: BorradorMedico;
  items: BorradorItem[];
}

export type CodigoAdvertencia = "RENGLON_NO_RECONOCIDO" | "UNIDADES_VS_DURACION" | "MAS_DE_UN_ITEM" | "DATO_FALTANTE" | "MATRICULA_DISTINTA";

/** A visible, non-blocking warning for the preview. `texto` carries the literal line when the warning is about one. */
export interface AdvertenciaParser {
  codigo: CodigoAdvertencia;
  mensaje: string;
  texto?: string;
}

export type CodigoErrorParser = "SIN_TEXTO" | "FORMATO_NO_RECONOCIDO" | "SIN_NRO_RECETA";

export interface ErrorParser {
  codigo: CodigoErrorParser;
  mensaje: string;
}

export type ResultadoParserReceta =
  | { ok: true; borrador: BorradorReceta; advertencias: AdvertenciaParser[] }
  | { ok: false; error: ErrorParser };

export const MENSAJES_ERROR_PARSER: Readonly<Record<CodigoErrorParser, string>> = {
  SIN_TEXTO: "El PDF no tiene texto legible (¿es una receta escaneada?). Solo se pueden importar recetas digitales.",
  FORMATO_NO_RECONOCIDO: "Formato de receta no reconocido.",
  SIN_NRO_RECETA: "No se encontró el número de receta del emisor, así que no se puede importar.",
};

// ============================================================================
// Rows and segments
// ============================================================================

export interface Segmento {
  texto: string;
  x: number;
  xFin: number;
}

export interface Renglon {
  pagina: number;
  /** Vertical center of the row's first item (top-left origin). */
  y: number;
  texto: string;
  segmentos: Segmento[];
  items: TextItemLite[];
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[medio]! : (ordenados[medio - 1]! + ordenados[medio]!) / 2;
}

function colapsar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function centroVertical(item: TextItemLite): number {
  return item.y + item.height / 2;
}

function construirRenglon(items: TextItemLite[], pagina: number): Renglon {
  const ordenados = [...items].sort((a, b) => a.x - b.x);
  // A horizontal gap wider than ~1.2 line heights starts a new segment (a
  // separate column); word spacing is a fraction of the line height.
  const umbralSegmento = Math.max(6, mediana(ordenados.map((i) => i.height)) * 1.2);
  const segmentos: Segmento[] = [];
  let actual: { partes: string[]; x: number; xFin: number } | null = null;
  for (const item of ordenados) {
    if (actual && item.x - actual.xFin <= umbralSegmento) {
      actual.partes.push(item.str);
      actual.xFin = Math.max(actual.xFin, item.x + item.width);
    } else {
      if (actual) segmentos.push({ texto: colapsar(actual.partes.join(" ")), x: actual.x, xFin: actual.xFin });
      actual = { partes: [item.str], x: item.x, xFin: item.x + item.width };
    }
  }
  if (actual) segmentos.push({ texto: colapsar(actual.partes.join(" ")), x: actual.x, xFin: actual.xFin });

  return {
    pagina,
    y: centroVertical(ordenados[0]!),
    texto: colapsar(ordenados.map((i) => i.str).join(" ")),
    segmentos,
    items: ordenados,
  };
}

/**
 * Groups one page's items into visual rows, top to bottom (spec: tolerance
 * `max(2, medianHeight * 0.6)` on the vertical position -- measured at each
 * item's vertical center, so fragments of different font sizes on the same
 * line still group together).
 */
export function agruparRenglones(items: readonly TextItemLite[], pagina = 0): Renglon[] {
  const visibles = items.filter((i) => i.str.trim().length > 0);
  if (visibles.length === 0) return [];
  const tolerancia = Math.max(2, mediana(visibles.map((i) => i.height)) * 0.6);
  const ordenados = [...visibles].sort((a, b) => centroVertical(a) - centroVertical(b) || a.x - b.x);

  const grupos: TextItemLite[][] = [];
  let ancla = Number.NEGATIVE_INFINITY;
  for (const item of ordenados) {
    const centro = centroVertical(item);
    if (grupos.length === 0 || centro - ancla > tolerancia) {
      grupos.push([item]);
      ancla = centro;
    } else {
      grupos[grupos.length - 1]!.push(item);
    }
  }
  return grupos.map((g) => construirRenglon(g, pagina));
}

// ============================================================================
// Generic value helpers (shared by every emisor strategy)
// ============================================================================

/**
 * es-AR number as printed -> decimal string with a dot. A comma is the
 * decimal separator ("0,3" -> "0.3", "1.000,5" -> "1000.5"); dots in
 * groups of three are thousands separators ("1.000" -> "1000"); any other
 * lone dot is taken as a decimal point ("1.5" -> "1.5"). `null` when the
 * text is not a number.
 */
export function parsearDecimalEsAr(texto: string): string | null {
  const t = texto.trim();
  let normalizado: string;
  if (/^\d{1,3}(\.\d{3})*,\d+$/.test(t) || /^\d+,\d+$/.test(t)) {
    normalizado = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    normalizado = t.replace(/\./g, "");
  } else if (/^\d+(\.\d+)?$/.test(t)) {
    normalizado = t;
  } else {
    return null;
  }
  // Canonical form: no leading zeros ("030" -> "30"), no trailing decimal zeros ("0.50" -> "0.5").
  const [entero, decimales] = normalizado.split(".") as [string, string | undefined];
  const enteroLimpio = entero.replace(/^0+(?=\d)/, "");
  const decimalesLimpios = decimales?.replace(/0+$/, "") ?? "";
  return decimalesLimpios.length > 0 ? `${enteroLimpio}.${decimalesLimpios}` : enteroLimpio;
}

/** "dd/mm/aaaa" -> "aaaa-mm-dd", `null` if it is not a real calendar date. */
export function parsearFechaDdMmAaaa(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/** Spec "Separación de nombres" -- see `NombreSeparado`. */
export function separarNombre(completo: string): NombreSeparado | null {
  const nombreCompleto = colapsar(completo);
  if (nombreCompleto.length === 0) return null;
  const palabras = nombreCompleto.split(" ");
  if (palabras.length === 1) {
    return { nombreCompleto, nombre: "", apellido: palabras[0]!, requiereConfirmacion: true };
  }
  return {
    nombreCompleto,
    nombre: palabras.slice(0, -1).join(" "),
    apellido: palabras[palabras.length - 1]!,
    requiereConfirmacion: palabras.length > 2,
  };
}

function formatearNumeroEsAr(valor: number): string {
  const redondeado = Math.round(valor * 100) / 100;
  return Number.isInteger(redondeado) ? String(redondeado) : String(redondeado).replace(".", ",");
}

// ============================================================================
// Rp./ body line classification
// ============================================================================

const UNIDADES_COMPONENTE = "mg|g|mcg|µg|μg|ml|ui|%";
const RE_COMPONENTE = new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)*)\\s*(${UNIDADES_COMPONENTE})$`, "i");

/** Presentation lexicon (normalized, singular/plural) -> FormaFarmaceutica. Only the unit-count forms a "N <forma>" line can express. */
const LEXICO_PRESENTACION: ReadonlyArray<{ patron: RegExp; forma: FormaFarmaceutica }> = [
  { patron: /^comprimidos?$/, forma: "COMPRIMIDO" },
  { patron: /^capsulas?$/, forma: "CAPSULA" },
  { patron: /^ovulos?$/, forma: "OVULO" },
  { patron: /^supositorios?$/, forma: "SUPOSITORIO" },
];
const RE_PRESENTACION = /^(\d+)\s+([a-z]+)$/;

const RE_FRACCION = /(^|\s)(media|½|1\/2)\s+dosis(\s|$)/;
/** "cada N horas/hs" -- also what the consistency check reads the dosing interval from. */
const RE_CADA_N_HORAS = /\bcada\s+(\d+(?:[.,]\d+)?)\s*(?:horas?|hs?)\b\.?/;
/** Other dosing instructions besides "cada N horas". */
const RES_POSOLOGIA: readonly RegExp[] = [
  RE_CADA_N_HORAS,
  /\b\d+\s+(?:vez|veces)\s+(?:al|por)\s+dia\b/,
  /\b(?:tomar|aplicar|administrar|colocar)\b/,
  /\b(?:en ayunas|antes de|despues de|al acostarse)\b/,
];
const RE_DURACION = /^tratamiento\s+por\s+(\d+)\s+dias?\.?$/;

export type ClaseRenglon =
  | { clase: "componente"; drogaTexto: string; cantidad: string; unidadTexto: string }
  | { clase: "presentacion"; cantidadUnidades: number; formaFarmaceutica: FormaFarmaceutica }
  | { clase: "indicacion"; fraccion: boolean; posologia: boolean }
  | { clase: "duracion"; dias: number }
  | { clase: "otro" };

/**
 * Classifies ONE body line with the first rule that matches (spec table,
 * after the "ignorado" rule, which only the caller can apply since it
 * depends on the line's position). Fracción and posología can hold at the
 * same time ("Media dosis cada 12 horas"), hence one `indicacion` class
 * with both flags.
 */
export function clasificarRenglonCuerpo(texto: string): ClaseRenglon {
  const original = colapsar(texto);
  const normalizado = normalizarTexto(original);

  const comp = RE_COMPONENTE.exec(original);
  if (comp) {
    const cantidad = parsearDecimalEsAr(comp[2]!);
    if (cantidad !== null && Number(cantidad) > 0) {
      return { clase: "componente", drogaTexto: colapsar(comp[1]!), cantidad, unidadTexto: comp[3]! };
    }
  }

  const pres = RE_PRESENTACION.exec(normalizado);
  if (pres) {
    const forma = LEXICO_PRESENTACION.find((l) => l.patron.test(pres[2]!))?.forma;
    const cantidadUnidades = Number(pres[1]);
    if (forma && cantidadUnidades > 0) return { clase: "presentacion", cantidadUnidades, formaFarmaceutica: forma };
  }

  const fraccion = RE_FRACCION.test(normalizado);
  const posologia = RES_POSOLOGIA.some((re) => re.test(normalizado));
  if (fraccion || posologia) return { clase: "indicacion", fraccion, posologia };

  const dur = RE_DURACION.exec(normalizado);
  if (dur && Number(dur[1]) > 0) return { clase: "duracion", dias: Number(dur[1]) };

  return { clase: "otro" };
}

interface ResultadoCuerpo {
  item: BorradorItem;
  advertencias: AdvertenciaParser[];
}

/** Builds the (single) item from the body lines found between `Rp./` and `Diagnóstico:`. */
function parsearCuerpo(lineas: readonly string[]): ResultadoCuerpo {
  const item: BorradorItem = {
    formaFarmaceutica: null,
    cantidadUnidades: null,
    fraccionDosisPorUnidad: "1",
    posologia: null,
    duracionTratamientoDias: null,
    componentes: [],
  };
  const advertencias: AdvertenciaParser[] = [];
  let avisoMultiplesItems = false;
  const avisarMultiplesItems = (texto: string) => {
    if (avisoMultiplesItems) return;
    avisoMultiplesItems = true;
    advertencias.push({
      codigo: "MAS_DE_UN_ITEM",
      mensaje: `La receta parece tener más de un ítem (renglón «${texto}»). Se carga un único ítem: revisá los ítems.`,
      texto,
    });
  };

  lineas.forEach((texto, idx) => {
    // Spec: a first line starting with "- " right after Rp./ is dropped silently (meaning unknown).
    if (idx === 0 && /^-\s/.test(texto)) return;

    const c = clasificarRenglonCuerpo(texto);
    switch (c.clase) {
      case "componente":
        if (item.cantidadUnidades !== null) avisarMultiplesItems(texto);
        item.componentes.push({ drogaTexto: c.drogaTexto, cantidad: c.cantidad, unidadTexto: c.unidadTexto, modoExpresion: "POR_DOSIS" });
        return;
      case "presentacion":
        if (item.cantidadUnidades !== null) {
          avisarMultiplesItems(texto);
          return;
        }
        item.cantidadUnidades = c.cantidadUnidades;
        item.formaFarmaceutica = c.formaFarmaceutica;
        return;
      case "indicacion":
        if (c.fraccion) item.fraccionDosisPorUnidad = "0.5";
        if (c.posologia) item.posologia = item.posologia ? `${item.posologia}. ${texto}` : texto;
        return;
      case "duracion":
        item.duracionTratamientoDias = c.dias;
        return;
      case "otro":
        advertencias.push({ codigo: "RENGLON_NO_RECONOCIDO", mensaje: `No se reconoció el renglón «${texto}». Revisalo y cargalo a mano si corresponde.`, texto });
        return;
    }
  });

  const consistencia = controlarUnidadesVsDuracion(item);
  if (consistencia) advertencias.push(consistencia);

  return { item, advertencias };
}

/**
 * Spec "Control de consistencia": one unit per toma, `24 / N` tomas per day
 * ("cada N horas"). If the units last a different number of days than the
 * prescribed treatment -> a warning (never a block). Skipped unless the
 * three inputs are present.
 */
export function controlarUnidadesVsDuracion(item: Pick<BorradorItem, "cantidadUnidades" | "posologia" | "duracionTratamientoDias">): AdvertenciaParser | null {
  if (item.cantidadUnidades === null || item.posologia === null || item.duracionTratamientoDias === null) return null;
  const cada = RE_CADA_N_HORAS.exec(normalizarTexto(item.posologia));
  if (!cada) return null;
  const horas = Number(parsearDecimalEsAr(cada[1]!));
  if (!(horas > 0)) return null;
  const tomasPorDia = 24 / horas;
  const diasQueAlcanzan = item.cantidadUnidades / tomasPorDia;
  if (Math.abs(diasQueAlcanzan - item.duracionTratamientoDias) < 1e-9) return null;
  return {
    codigo: "UNIDADES_VS_DURACION",
    mensaje: `Las unidades alcanzan para ${formatearNumeroEsAr(diasQueAlcanzan)} días; la receta indica ${item.duracionTratamientoDias}.`,
  };
}

// ============================================================================
// Emisor strategies
// ============================================================================

export interface ContextoParser {
  renglones: Renglon[];
  links: readonly LinkLite[];
}

export interface EstrategiaEmisor {
  codigo: CodigoEmisor;
  detectar(ctx: ContextoParser): boolean;
  parsear(ctx: ContextoParser): ResultadoParserReceta;
}

const RE_REGISTRO_EMISOR = /\bRL-\d{4}-\d{9}\b/;

/** `true` if `uri` is an http(s) URL on `host` (or a subdomain) whose path starts with `prefijoPath`. */
function esLinkDe(uri: string, host: string, prefijoPath: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase();
  return (hostname === host || hostname.endsWith(`.${host}`)) && url.pathname.startsWith(prefijoPath);
}

function primerMatch(textos: Iterable<string>, re: RegExp): RegExpExecArray | null {
  for (const texto of textos) {
    const m = re.exec(texto);
    if (m) return m;
  }
  return null;
}

function* segmentosDe(renglones: readonly Renglon[]): Generator<string> {
  for (const r of renglones) for (const s of r.segmentos) yield s.texto;
}

function* textosDe(renglones: readonly Renglon[]): Generator<string> {
  for (const r of renglones) yield r.texto;
}

// ----------------------------------------------------------------------------
// RCTA ("Tu Recetario Digital") -- verification link on verumrp.com.ar.
// ----------------------------------------------------------------------------

const RCTA_HOST = "verumrp.com.ar";
const RCTA_PATH = "/prescripcion/";

/**
 * `true` if `uri` is the emisor's own verification link (same host/path
 * rule the parser uses to pick it) -- the confirmation re-checks the URL
 * the client sends back, so nothing but the emisor's link is ever stored
 * and rendered as a link.
 */
export function esUrlVerificacionDeEmisor(emisor: CodigoEmisor, uri: string): boolean {
  switch (emisor) {
    case "RCTA":
      return esLinkDe(uri, RCTA_HOST, RCTA_PATH);
  }
}
/** RCTA's own number in the national registry of electronic recetarios, as printed on its recetas. */
const RCTA_REGISTROS: readonly string[] = ["RL-2024-100292307"];

const RE_RP = /^Rp\.?\/?\s*(.*)$/i;
const RE_DIAGNOSTICO = /^Diagn[óo]stico:?\s*(.*)$/i;
const RE_DIAGNOSTICO_CODIGO = /^([A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?)\s*-\s*(.+)$/;
/** Footer markers that end the body when a receta has no "Diagnóstico:" line. */
const RE_FIN_CUERPO = /^(FIRMA Y SELLO|Este documento ha sido firmado|Dra?\.\s)/i;
const RE_ESPECIALIDAD = /^M[ÉE]DICO\s*-\s*(.+)$/i;
const RE_NRO_RECETA = /^\d{10,}$/;

function parsearRcta(ctx: ContextoParser): ResultadoParserReceta {
  const { renglones } = ctx;
  const advertencias: AdvertenciaParser[] = [];

  const iRp = renglones.findIndex((r) => RE_RP.test(r.texto) && /^rp\b/i.test(r.texto));
  const encabezado = iRp >= 0 ? renglones.slice(0, iRp) : renglones;

  // --- Nro de receta: the barcode's number, top-LEFT of the header. The
  // same top row also carries the paciente's CUIL barcode on the right, so
  // only the left half of the printed area counts. ---
  const bordeDerecho = Math.max(...renglones.flatMap((r) => r.items.map((i) => i.x + i.width)));
  const esNroReceta = (i: TextItemLite) => RE_NRO_RECETA.test(i.str.trim()) && i.x < bordeDerecho / 2;
  const renglonNro = encabezado.find((r) => r.items.some(esNroReceta));
  const candidatos = (renglonNro?.items ?? []).filter(esNroReceta).sort((a, b) => a.x - b.x);
  const nroRecetaEmisor = candidatos[0]?.str.trim() ?? null;
  if (nroRecetaEmisor === null) {
    return { ok: false, error: { codigo: "SIN_NRO_RECETA", mensaje: MENSAJES_ERROR_PARSER.SIN_NRO_RECETA } };
  }

  const urlVerificacion = ctx.links.find((l) => esLinkDe(l.uri, RCTA_HOST, RCTA_PATH))?.uri ?? null;

  // --- Fechas ---
  const creada = primerMatch(segmentosDe(encabezado), /Creada:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const validaDesde = primerMatch(segmentosDe(encabezado), /V[áa]lida\s+desde:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const fechaPrescripcion = creada ? parsearFechaDdMmAaaa(creada[1]!) : null;
  const fechaValidaDesde = validaDesde ? parsearFechaDdMmAaaa(validaDesde[1]!) : null;

  // --- Paciente ---
  const pacienteNombre = primerMatch(segmentosDe(encabezado), /^Paciente:\s*(.+)$/i);
  const dni = primerMatch(segmentosDe(encabezado), /\bDNI:\s*([\d.]+)/i);
  const cuil = primerMatch(segmentosDe(encabezado), /\bCUIL:\s*([\d-]+)/i);
  const sexo = primerMatch(segmentosDe(encabezado), /^Sexo:\s*(.+)$/i);
  const nacimiento = primerMatch(segmentosDe(encabezado), /F\.?\s*Nacimiento:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const credencial = primerMatch(segmentosDe(encabezado), /\bN\S{0,2}\s*Credencial:\s*(\S+)/i);
  const paciente: BorradorPaciente = {
    nombre: pacienteNombre ? separarNombre(pacienteNombre[1]!) : null,
    dni: dni ? dni[1]!.replace(/\D/g, "") : null,
    cuil: cuil ? cuil[1]!.replace(/\D/g, "") : null,
    sexo: sexo ? colapsar(sexo[1]!) : null,
    fechaNacimiento: nacimiento ? parsearFechaDdMmAaaa(nacimiento[1]!) : null,
    nroCredencial: credencial ? credencial[1]! : null,
  };

  // --- Médico (upper block): name on the row right above "MÉDICO - <especialidad>". ---
  let medicoNombre: NombreSeparado | null = null;
  let especialidad: string | null = null;
  const iEspecialidad = encabezado.findIndex((r) => r.segmentos.some((s) => RE_ESPECIALIDAD.test(s.texto)));
  if (iEspecialidad >= 0) {
    const segEsp = encabezado[iEspecialidad]!.segmentos.find((s) => RE_ESPECIALIDAD.test(s.texto))!;
    especialidad = colapsar(RE_ESPECIALIDAD.exec(segEsp.texto)![1]!);
    const centroEsp = (segEsp.x + segEsp.xFin) / 2;
    for (let i = iEspecialidad - 1; i >= 0; i--) {
      const candidatosNombre = encabezado[i]!.segmentos.filter((s) => !/^[\d\s]+$/.test(s.texto));
      if (candidatosNombre.length === 0) continue;
      candidatosNombre.sort((a, b) => Math.abs((a.x + a.xFin) / 2 - centroEsp) - Math.abs((b.x + b.xFin) / 2 - centroEsp));
      medicoNombre = separarNombre(candidatosNombre[0]!.texto.replace(/^Dra?\.\s*/i, ""));
      break;
    }
  }

  // Matrícula: "Matrícula Prov.:NNNN" / "Matrícula Nac.:NNNN" in the header, else "MP NNNN" / "MN NNNN" anywhere below.
  let matricula: string | null = null;
  let matriculaJurisdiccion: JurisdiccionMatriculaPdf | null = null;
  const matEncabezado = primerMatch(segmentosDe(encabezado), /Matr[íi]cula\s*(Prov|Nac)\.?\s*:?\s*([A-Z0-9][A-Z0-9./-]*)/i);
  const matPie = primerMatch(segmentosDe(iRp >= 0 ? renglones.slice(iRp) : renglones), /^(MP|MN)\s*:?\s*(\d[\d./-]*)$/i);
  const matriculaPie = matPie ? matPie[2]!.replace(/[./-]+$/, "") : null;
  if (matEncabezado) {
    matriculaJurisdiccion = /^nac/i.test(matEncabezado[1]!) ? "NACIONAL" : "PROVINCIAL";
    matricula = matEncabezado[2]!.replace(/[./-]+$/, "");
    if (matriculaPie !== null && matriculaPie.toUpperCase() !== matricula.toUpperCase()) {
      advertencias.push({
        codigo: "MATRICULA_DISTINTA",
        mensaje: `La matrícula del encabezado (${matricula}) no coincide con la del pie de la receta (${matriculaPie}). Se usa la del encabezado: verificala.`,
      });
    }
  } else if (matPie) {
    matriculaJurisdiccion = matPie[1]!.toUpperCase() === "MN" ? "NACIONAL" : "PROVINCIAL";
    matricula = matriculaPie;
  }

  // --- Cuerpo Rp./ ... Diagnóstico: ---
  let diagnosticoCodigo: string | null = null;
  let diagnosticoDescripcion: string | null = null;
  let item: BorradorItem | null = null;
  let finCuerpo = renglones.length;
  if (iRp >= 0) {
    const lineas: string[] = [];
    const restoRp = RE_RP.exec(renglones[iRp]!.texto)![1]!.trim();
    if (restoRp.length > 0) lineas.push(restoRp);
    for (let i = iRp + 1; i < renglones.length; i++) {
      const texto = renglones[i]!.texto;
      const diag = RE_DIAGNOSTICO.exec(texto);
      if (diag) {
        finCuerpo = i + 1;
        const valor = colapsar(diag[1]!);
        const conCodigo = RE_DIAGNOSTICO_CODIGO.exec(valor);
        if (conCodigo) {
          diagnosticoCodigo = conCodigo[1]!;
          diagnosticoDescripcion = colapsar(conCodigo[2]!);
        } else if (valor.length > 0) {
          diagnosticoDescripcion = valor;
        }
        break;
      }
      if (RE_FIN_CUERPO.test(renglones[i]!.segmentos[0]!.texto)) {
        finCuerpo = i;
        break;
      }
      lineas.push(texto);
    }
    const cuerpo = parsearCuerpo(lineas);
    item = cuerpo.item;
    advertencias.push(...cuerpo.advertencias);
  }

  // --- Pie: dirección y teléfono del médico. ---
  const contacto = primerMatch(textosDe(renglones.slice(finCuerpo)), /^(.+?)\s+Tel[ée]fono:?\s*([\d\s()+-]*\d)/i);

  const medico: BorradorMedico = {
    nombre: medicoNombre,
    especialidad,
    matricula,
    matriculaJurisdiccion,
    direccionRegistrada: contacto ? colapsar(contacto[1]!) : null,
    telefono: contacto ? colapsar(contacto[2]!) : null,
  };

  const itemFinal: BorradorItem = item ?? {
    formaFarmaceutica: null,
    cantidadUnidades: null,
    fraccionDosisPorUnidad: "1",
    posologia: null,
    duracionTratamientoDias: null,
    componentes: [],
  };

  // Missing data the preview must ask for (never blocking here -- only the nro de receta is).
  const faltante = (mensaje: string) => advertencias.push({ codigo: "DATO_FALTANTE", mensaje });
  if (!paciente.nombre) faltante("No se encontró el nombre del paciente.");
  if (!medicoNombre) faltante("No se encontró el nombre del médico.");
  if (!matricula) faltante("No se encontró la matrícula del médico.");
  if (!fechaPrescripcion) faltante("No se encontró la fecha de creación de la receta.");
  if (iRp < 0) faltante("No se encontró el cuerpo de la receta (Rp./).");
  else if (itemFinal.componentes.length === 0) faltante("No se encontraron componentes con su dosis.");
  if (iRp >= 0 && itemFinal.cantidadUnidades === null) faltante("No se encontró la cantidad de unidades (por ejemplo, «30 comprimidos»).");

  return {
    ok: true,
    borrador: {
      emisor: "RCTA",
      nroRecetaEmisor,
      urlVerificacion,
      fechaPrescripcion,
      fechaValidaDesde,
      diagnosticoCodigo,
      diagnosticoDescripcion,
      paciente,
      medico,
      items: [itemFinal],
    },
    advertencias,
  };
}

export const ESTRATEGIA_RCTA: EstrategiaEmisor = {
  codigo: "RCTA",
  detectar: (ctx) =>
    ctx.links.some((l) => esLinkDe(l.uri, RCTA_HOST, RCTA_PATH)) ||
    ctx.renglones.some((r) => {
      const registro = RE_REGISTRO_EMISOR.exec(r.texto);
      return registro !== null && RCTA_REGISTROS.includes(registro[0]);
    }),
  parsear: parsearRcta,
};

/** Every known emisor, tried in order. A new emisor is a new strategy (with its own tests), never a branch inside another one. */
export const ESTRATEGIAS_EMISOR: readonly EstrategiaEmisor[] = [ESTRATEGIA_RCTA];

// ============================================================================
// Entry point
// ============================================================================

export function parsearRecetaPdf(input: RecetaPdfInput, estrategias: readonly EstrategiaEmisor[] = ESTRATEGIAS_EMISOR): ResultadoParserReceta {
  const renglones = input.pages.flatMap((items, pagina) => agruparRenglones(items, pagina));
  if (renglones.length === 0) {
    return { ok: false, error: { codigo: "SIN_TEXTO", mensaje: MENSAJES_ERROR_PARSER.SIN_TEXTO } };
  }
  const ctx: ContextoParser = { renglones, links: input.links };
  const estrategia = estrategias.find((e) => e.detectar(ctx));
  if (!estrategia) {
    return { ok: false, error: { codigo: "FORMATO_NO_RECONOCIDO", mensaje: MENSAJES_ERROR_PARSER.FORMATO_NO_RECONOCIDO } };
  }
  return estrategia.parsear(ctx);
}
