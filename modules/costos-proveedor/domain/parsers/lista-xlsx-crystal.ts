/**
 * Parser of the supplier price list "Lista de medicamentos" (docs/specs/costos-proveedor.md
 * R16): a Crystal Reports export that the user re-saves as .xlsx. PURE: the input is the
 * raw cell values of ONE sheet (`infrastructure/leer-xlsx.server.ts` reads them), the output
 * the data rows with their price and, when the description ends in a presentation, which one.
 *
 * Layout (verified on the real file):
 *   - a header row with `DESCRIPCION` and `PRECIO` (other header cells -- `PRECIO mg`,
 *     `mg C/IVA`, `COSTO` -- are spreadsheet formulas and are never read);
 *   - one data row per product: description, price per kg / L / u, net of IVA;
 *   - Crystal repeats the header on every page and closes each page with a footer
 *     (`Page n of m`, in either column); the sheet ends with a `COSTO PREPARACION` row;
 *   - blank rows, and extra numeric columns that are ignored.
 *
 * Decisions:
 *   - Row numbers are the sheet's own (1-based, the first input row is row 1), so a message
 *     can say "fila 57" and the user finds it in Excel.
 *   - Whitespace inside a description is collapsed to single spaces ("ZOLPIDEM TARTRATO  Sicotrop L4"
 *     -> "ZOLPIDEM TARTRATO Sicotrop L4"): the control markers (`Sicotrop L4`, `Sedronar L2`) are part
 *     of the name and are KEPT; the double space is only layout noise and matching normalizes it anyway.
 *   - A price that is a JS number is turned into a decimal string through
 *     `Decimal#toSignificantDigits(15)`: 15 significant digits is what Excel itself keeps and shows,
 *     so the binary noise of a stored double (29801.136000000002) disappears
 *     (-> "29801.136") without ever rounding a real price (the lists carry at most 9 digits).
 *   - A price given as TEXT is parsed exactly: "40.898,50" (es-AR) and "40898.5" (plain).
 *   - A row with a description but no usable price is KEPT with `precio: null` (R18 "precio inválido").
 *   - `descartadas` counts the non-blank rows that are not data rows (footers, `COSTO PREPARACION`,
 *     rows with no description); blank rows and header rows are not counted.
 */
import { dec } from "@/shared/decimal";
import { ValidationError } from "@/shared/errors";
import { parsearDecimalEsAr } from "@/modules/recetas/domain/receta-pdf-parser";
import { MAX_FILAS_LISTA } from "../archivo-lista";

export type CeldaCruda = string | number | null;
export type FilaCruda = readonly CeldaCruda[];

export interface FilaListaLeida {
  /** 1-based row number in the sheet. */
  numeroFila: number;
  /** As on the list, whitespace collapsed (control markers kept). */
  descripcion: string;
  /** Canonical decimal string (price per kg / L / u, net of IVA), or `null` when the cell is missing, not a number or not parseable. */
  precio: string | null;
  /** The presentation suffix ("Bidon X 10", "X 0.050"), when the row is a presentation row (R16): those are listed as omitted. `null` for a base row. */
  presentacion: string | null;
}

export interface ResultadoParseoLista {
  filas: FilaListaLeida[];
  descartadas: number;
}

export const MENSAJES_PARSER_LISTA = {
  sinEncabezado: "No se encontró la fila de encabezado (DESCRIPCION y PRECIO) en la hoja. ¿Es la lista de medicamentos del proveedor?",
  /** "5.000" spelled out: `MAX_FILAS_LISTA` (asserted by the parser test). */
  demasiadasFilas: "La hoja tiene más de 5.000 filas de productos; no parece una lista de precios.",
} as const;

/** Header cells are compared without case, accents or extra spaces. */
function normalizarCelda(celda: CeldaCruda | undefined): string {
  if (typeof celda !== "string") return "";
  return celda
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function colapsarEspacios(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function textoDe(celda: CeldaCruda | undefined): string {
  if (typeof celda === "string") return colapsarEspacios(celda);
  if (typeof celda === "number" && Number.isFinite(celda)) return String(celda);
  return "";
}

function estaVacia(fila: FilaCruda): boolean {
  return fila.every((celda) => celda === null || celda === undefined || (typeof celda === "string" && celda.trim() === ""));
}

const PIE_DE_PAGINA = /^page\s+\d+\s+of\s+\d+$/i;

function esPieDePagina(fila: FilaCruda): boolean {
  return fila.some((celda) => typeof celda === "string" && PIE_DE_PAGINA.test(celda.trim()));
}

/** The closing row of the export: its label is `COSTO PREPARACION`, never a product. */
function esFilaDeCostoPreparacion(descripcion: string): boolean {
  return normalizarCelda(descripcion) === "costo preparacion";
}

// ============================================================================
// Presentation suffix (R16)
// ============================================================================

const ENVASES = "Bid[oó]n|Tambor|Pet|Cu[ñn]ete|Bolsa|Frasco|Caja|Bols[ií]n|Balde|Pote|Bote|Lata|Sobre|Sachet|Envase";

/**
 * The suffix a presentation row ends with: `(<envase> )?X <number>`, anchored at the END of the
 * description ("... FNA VI Bidon X 10", "... X 0.050", "... Pet X 0.250", "ACEITE DE GIRASOL . X 1" with
 * a stray dot as envase). The envase word is optional on purpose: the list also has bare "X 0.500".
 */
const SUFIJO_PRESENTACION = new RegExp(`\\s+(?:(?:${ENVASES})\\s+|\\.\\s+)?X\\s*\\d+(?:[.,]\\d+)?\\s*$`, "iu");

/** A standalone `X` (the "A X B" of a dimension): "CINTA ADHESIVA BLANCA 2.50 CM X 4 M". */
const X_SUELTA = /(?:^|\s)X(?:\s|$)/i;

/**
 * R16: which presentation a description ends in, or `null` for a base row.
 *
 * LIMITATION (documented, by design): a MATERIAL whose name already holds a standalone " X "
 * (`CINTA ADHESIVA BLANCA 2.50 CM X 4 M X 12`, a product of its own, not a presentation of
 * another) is NOT taken for a presentation: the text before the trailing `X <n>` already
 * contains an " X ", so the row is read as a base row. The price is then compared by the user in
 * the preview (it is "sin asociar" unless that exact name is in the catalog). The flip side: a real
 * presentation of a product whose own name contains a standalone " X " is read as a base row too;
 * the preview shows it and the user can omit it.
 */
export function detectarPresentacion(descripcion: string): string | null {
  const coincidencia = SUFIJO_PRESENTACION.exec(descripcion);
  if (!coincidencia) return null;
  const antes = descripcion.slice(0, coincidencia.index);
  if (antes.trim() === "" || X_SUELTA.test(antes)) return null;
  return colapsarEspacios(coincidencia[0]).replace(/^\.\s*/, "");
}

// ============================================================================
// Prices
// ============================================================================

/** Digits Excel keeps of a double: see the module doc comment. */
const DIGITOS_SIGNIFICATIVOS = 15;

function precioDe(celda: CeldaCruda | undefined): string | null {
  if (typeof celda === "number") {
    if (!Number.isFinite(celda)) return null;
    const valor = dec(celda).toSignificantDigits(DIGITOS_SIGNIFICATIVOS);
    // decimal.js keeps the sign of a negative zero ("-0").
    return valor.isZero() ? "0" : valor.toFixed();
  }
  if (typeof celda === "string") {
    const texto = celda.trim().replace(/^\$\s*/, "");
    return texto === "" ? null : parsearDecimalEsAr(texto);
  }
  return null;
}

// ============================================================================
// Parser
// ============================================================================

interface Encabezado {
  indice: number;
  columnaDescripcion: number;
  columnaPrecio: number;
}

function buscarEncabezado(filas: readonly FilaCruda[]): Encabezado | null {
  for (let indice = 0; indice < filas.length; indice++) {
    const celdas = (filas[indice] ?? []).map(normalizarCelda);
    const columnaDescripcion = celdas.indexOf("descripcion");
    const columnaPrecio = celdas.indexOf("precio");
    if (columnaDescripcion !== -1 && columnaPrecio !== -1) return { indice, columnaDescripcion, columnaPrecio };
  }
  return null;
}

/**
 * Reads the data rows of one sheet. Throws a `ValidationError` (user-readable) when there is no header row or
 * the sheet has more than `MAX_FILAS_LISTA` data rows (R15).
 */
export function parsearListaCrystal(filas: readonly FilaCruda[]): ResultadoParseoLista {
  const encabezado = buscarEncabezado(filas);
  if (!encabezado) throw new ValidationError(MENSAJES_PARSER_LISTA.sinEncabezado);
  const { indice: indiceEncabezado, columnaDescripcion, columnaPrecio } = encabezado;

  const leidas: FilaListaLeida[] = [];
  let descartadas = 0;

  for (let indice = indiceEncabezado + 1; indice < filas.length; indice++) {
    const fila = filas[indice] ?? [];
    if (estaVacia(fila)) continue;
    // The export repeats the header on every page.
    if (normalizarCelda(fila[columnaDescripcion]) === "descripcion" && normalizarCelda(fila[columnaPrecio]) === "precio") continue;

    const descripcion = textoDe(fila[columnaDescripcion]);
    if (esPieDePagina(fila) || descripcion === "" || esFilaDeCostoPreparacion(descripcion)) {
      descartadas += 1;
      continue;
    }

    if (leidas.length >= MAX_FILAS_LISTA) throw new ValidationError(MENSAJES_PARSER_LISTA.demasiadasFilas);
    leidas.push({ numeroFila: indice + 1, descripcion, precio: precioDe(fila[columnaPrecio]), presentacion: detectarPresentacion(descripcion) });
  }

  return { filas: leidas, descartadas };
}
