/**
 * Parser of the supplier price list "LISTADO DE PRECIOS: CATALOGO" (openspec/specs/costos-proveedor/spec.md R16b,
 * R16c): another Crystal Reports export, uploaded as the .xls it is. PURE, like ./lista-xlsx-crystal.ts (the Lista
 * de medicamentos), whose row shape it returns; ./parsear-lista.ts picks one or the other by the header.
 *
 * Layout (verified on "Lista de precios actualizada 27-10-2026.xls"):
 *   - a "Fecha Impresión" / "LISTADO DE PRECIOS: CATALOGO" block, then a header row with `Codigo Producto`,
 *     `Descripción`, `UM`, `Mínimo`, `Precio`, `Tipo Iva` (`Mínimo` is never read);
 *   - one data row per product, its code `NNNNN/NNN`: `/000` is the BASE product, priced per its UM; any other
 *     suffix is a presentation of it (Bidon X 10, X 0.250...), whatever its text says;
 *   - the export places some values one column off their header (`Precio` header in R, its numbers in Q; `Tipo Iva`
 *     header in T, its letters in U), so each field is read from its header's column or an adjacent one (R16b);
 *   - page footers (`Page n of m`), repeated headers and a closing "SUJETA A VARIACION DE PRECIOS..." line.
 *
 * Decisions:
 *   - UM -> catalog unit (R16c): Kg, G, L, UN; `Mi` (millar) is u with the price divided by 1000, exactly
 *     (decimal.js). Any other UM (CJ, %...) maps to no unit: the preview then asks for one.
 *   - `Tipo Iva` E (exento) -> alícuota "0"; G or anything else -> no alícuota chosen (R7a inheritance).
 *   - Prices, row numbers, whitespace and `descartadas` follow the Lista de medicamentos parser.
 */
import { dec } from "@/shared/decimal";
import { ValidationError } from "@/shared/errors";
import { MAX_FILAS_LISTA } from "../archivo-lista";
import { colapsarEspacios, detectarPresentacion, estaVacia, MENSAJES_PARSER_LISTA, normalizarCelda, precioDe } from "./lista-xlsx-crystal";
import type { CeldaCruda, CodigoUnidadLista, FilaCruda, FilaListaLeida, ResultadoParseoLista, UnidadListaLeida } from "./lista-xlsx-crystal";

const COLUMNAS = { codigo: "codigo producto", descripcion: "descripcion", um: "um", precio: "precio", tipoIva: "tipo iva" } as const;
type Columnas = Record<keyof typeof COLUMNAS, number>;

const CODIGO_PRODUCTO = /^\d+\/\d+$/;
const SUFIJO_BASE = "/000";

/** R16c: the list's UM (normalized) to the catalog unit; `mi` is u per millar. */
const UNIDAD_DE_UM: Readonly<Record<string, CodigoUnidadLista>> = { kg: "KILOGRAMO", g: "GRAMO", l: "LITRO", un: "UNIDAD", mi: "UNIDAD" };
const UM_MILLAR = "mi";
const UNIDADES_POR_MILLAR = 1000;

/** R16c: the `Tipo Iva` of an exempt product. */
const TIPO_IVA_EXENTO = "e";
const ALICUOTA_EXENTO = "0";

function columnasDe(fila: FilaCruda | undefined): Columnas | null {
  const celdas = (fila ?? []).map(normalizarCelda);
  const columnas = Object.fromEntries(Object.entries(COLUMNAS).map(([campo, titulo]) => [campo, celdas.indexOf(titulo)])) as Columnas;
  return Object.values(columnas).every((indice) => indice !== -1) ? columnas : null;
}

/** Whether a sheet has the Catálogo header (./parsear-lista.ts). */
export function esListaCatalogo(filas: readonly FilaCruda[]): boolean {
  return filas.some((fila) => columnasDe(fila) !== null);
}

function tieneValor(celda: CeldaCruda | undefined): boolean {
  return celda !== null && celda !== undefined && !(typeof celda === "string" && celda.trim() === "");
}

/** R16b: the header's column, else the adjacent one before, else the one after; only a cell that `acepta`. */
function celdaCercana(fila: FilaCruda, columna: number, acepta: (celda: CeldaCruda) => boolean): CeldaCruda {
  for (const c of [columna, columna - 1, columna + 1]) {
    const celda = fila[c];
    if (celda !== undefined && tieneValor(celda) && acepta(celda)) return celda;
  }
  return null;
}

const esTexto = (celda: CeldaCruda) => typeof celda === "string";
/** A price cell: a number, or text the price reader understands. */
const esPrecio = (celda: CeldaCruda) => typeof celda === "number" || (typeof celda === "string" && precioDe(celda) !== null);

function textoCercano(fila: FilaCruda, columna: number): string {
  const celda = celdaCercana(fila, columna, esTexto);
  return typeof celda === "string" ? colapsarEspacios(celda) : "";
}

function unidadDe(um: string): UnidadListaLeida {
  const clave = um.toLowerCase();
  return { um, codigo: UNIDAD_DE_UM[clave] ?? null, porMillar: clave === UM_MILLAR };
}

/**
 * Reads the data rows of one Catálogo sheet. Throws a `ValidationError` (user-readable) when there is no header row
 * or the sheet has more than `MAX_FILAS_LISTA` data rows (R15).
 */
export function parsearListaCatalogo(filas: readonly FilaCruda[]): ResultadoParseoLista {
  const indiceEncabezado = filas.findIndex((fila) => columnasDe(fila) !== null);
  if (indiceEncabezado === -1) throw new ValidationError(MENSAJES_PARSER_LISTA.sinEncabezado);
  const columnas = columnasDe(filas[indiceEncabezado])!;

  const leidas: FilaListaLeida[] = [];
  let descartadas = 0;

  for (let indice = indiceEncabezado + 1; indice < filas.length; indice++) {
    const fila = filas[indice] ?? [];
    if (estaVacia(fila) || columnasDe(fila) !== null) continue; // blank rows and the header Crystal repeats on every page

    const codigo = textoCercano(fila, columnas.codigo);
    if (!CODIGO_PRODUCTO.test(codigo)) {
      descartadas += 1; // page footers, the closing line
      continue;
    }

    if (leidas.length >= MAX_FILAS_LISTA) throw new ValidationError(MENSAJES_PARSER_LISTA.demasiadasFilas);
    const descripcion = textoCercano(fila, columnas.descripcion);
    const unidadLista = unidadDe(textoCercano(fila, columnas.um));
    const precio = precioDe(celdaCercana(fila, columnas.precio, esPrecio));
    const tipoIva = textoCercano(fila, columnas.tipoIva).toLowerCase();
    leidas.push({
      numeroFila: indice + 1,
      descripcion,
      precio: precio !== null && unidadLista.porMillar ? dec(precio).dividedBy(UNIDADES_POR_MILLAR).toFixed() : precio,
      presentacion: codigo.endsWith(SUFIJO_BASE) ? null : (detectarPresentacion(descripcion) ?? `código ${codigo}`),
      unidadLista,
      alicuotaIva: tipoIva === TIPO_IVA_EXENTO ? ALICUOTA_EXENTO : null,
    });
  }

  return { filas: leidas, descartadas };
}
