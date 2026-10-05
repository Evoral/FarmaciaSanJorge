/**
 * Supplier invoice PDF parser (/stock/ingresar, "Importar factura"). Pure:
 * positioned text items in (shared/pdf/extraer-texto-pdf.server.ts), a
 * draft out. Nothing here matches against the catalog -- that is
 * ../application/leer-factura-compra-pdf.ts's job.
 *
 * Layout (Droguería Saporiti, AFIP "Factura A"): a header with labelled
 * values ("Factura: 0006-00983051", "Fecha:", "C.U.I.T.:", the letra boxed
 * at the top centre), then a detail table where each product row
 *
 *   00369/010  CELULOSA MICROCRISTALINA PH 101 X 1   Kg  3.000  21,630.00  64,890.00
 *
 * is followed by one row per container of that product:
 *
 *   Desp.:23 001 IC04 211797 T  L:036110  Orig:INDIA  Envases:1,170/1,170
 *
 * The same lote repeats once per container, so rows are merged by lote.
 * The invoice gives the quantity per PRODUCT only: with a single lote it
 * is the lote's; with several it is split by container count and flagged
 * for the user to check. Then the totals block and, optionally,
 * "Faltantes:" (items ordered but not delivered -- never ingresados).
 *
 * Count units sold by the hundred or thousand ("Mi" = millar: 5.000 Mi at
 * 20,085.00 = 5 thousand capsules at 20,085.00 per thousand) are converted
 * to plain units ("u": 5000 at 20.085 each) and flagged, since the catalog
 * has no millar unit. Quantities and prices come out normalized ("5", not
 * "5.000", which reads as five thousand in Argentina).
 *
 * Numbers use "," for thousands and "." for decimals ("23,175.00",
 * "1.000" = one); the other convention ("23.175,00") is also accepted.
 */
import Decimal from "decimal.js";
import type { TextoPdf, TextoPdfItem } from "@/shared/pdf/extraer-texto-pdf.server";
import { MAX_PDF_BYTES } from "@/modules/recetas/domain/archivo-receta-pdf";

/** Same limit as the receta import: next.config.ts's Server Actions `bodySizeLimit` is sized for it. */
export const MAX_FACTURA_PDF_BYTES = MAX_PDF_BYTES;
export const MAX_FACTURA_PDF_PAGINAS = 10;

export const MENSAJES_ARCHIVO_FACTURA = {
  noEsArchivo: "Adjuntá el PDF de la factura.",
  vacio: "El archivo está vacío.",
  demasiadoGrande: `El archivo supera el máximo de ${MAX_FACTURA_PDF_BYTES / (1024 * 1024)} MB.`,
  tipoIncorrecto: "El archivo debe ser un PDF.",
  sinFirmaPdf: "El archivo no es un PDF válido.",
  protegido: "PDF protegido: pide contraseña para abrirlo. Solo se pueden importar facturas que se abran sin contraseña.",
  ilegible: "No se pudo leer el PDF.",
  demasiadasPaginas: `El PDF tiene más de ${MAX_FACTURA_PDF_PAGINAS} páginas; no parece una factura.`,
} as const;

export interface LoteFacturaBorrador {
  /** "" when the product row had no lote underneath (the user types it). */
  lote: string;
  /** In the product's purchase unit, decimal string ("3.000"). */
  cantidad: string;
  despacho: string | null;
  paisOrigen: string | null;
  /** ISO date, only when the supplier prints it ("Vto.:"/"Venc.:" in the lote row). */
  fechaVencimiento: string | null;
}

export interface ItemFacturaBorrador {
  /** Supplier's product code ("00369/010"). */
  codigo: string;
  /** As printed ("CELULOSA MICROCRISTALINA PH 101 X 1"). */
  descripcion: string;
  /** Description without the trailing presentation ("X 1", "X 0.250") -- what is matched against the catalog. */
  drogaTexto: string;
  unidadTexto: string;
  cantidad: string;
  /** Net (without IVA), per purchase unit. */
  precioUnitario: string;
  lotes: LoteFacturaBorrador[];
}

export interface BorradorFactura {
  /** 11 digits, no dashes. */
  emisorCuit: string | null;
  letra: string | null;
  /** Without leading zeros ("6"). */
  puntoVenta: string;
  /** Without leading zeros ("983051"). */
  numero: string;
  fechaEmision: string;
  cae: string | null;
  subtotal: string | null;
  iva: string | null;
  total: string | null;
  items: ItemFacturaBorrador[];
}

export type CodigoAdvertenciaParserFactura = "ITEM_SIN_LOTE" | "CANTIDAD_REPARTIDA" | "FALTANTES" | "UNIDAD_CONVERTIDA";

export interface AdvertenciaParserFactura {
  codigo: CodigoAdvertenciaParserFactura;
  mensaje: string;
}

export type ResultadoParserFactura =
  | { ok: true; borrador: BorradorFactura; advertencias: AdvertenciaParserFactura[] }
  | { ok: false; error: { mensaje: string } };

const MISMA_FILA_PT = 4;
const RE_CODIGO_PRODUCTO = /^\d{3,6}\/\d{1,4}$/;
const RE_FECHA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const RE_PRESENTACION = /\s+X\s+[\d.,]+\s*$/i;
/** Supplier marks printed after the description ("(*)", "**"). */
const RE_MARCAS = /(\s+(\(\*+\)|\*+))+\s*$/;

/** Count units priced per hundred / thousand -> factor to plain units ("u", migration 0006's UNIDAD). */
const MULTIPLOS_UNIDAD: Readonly<Record<string, { factor: number; nombre: string }>> = {
  mi: { factor: 1000, nombre: "millar" },
  mil: { factor: 1000, nombre: "millar" },
  millar: { factor: 1000, nombre: "millar" },
  ci: { factor: 100, nombre: "ciento" },
  ciento: { factor: 100, nombre: "ciento" },
};

/** "23,175.00" -> "23175.00"; "1.000" -> "1.000"; "23.175,00" -> "23175.00". `null` if it is not a number. */
export function numeroFactura(texto: string): string | null {
  let t = texto.replace(/\s|\$/g, "");
  const coma = t.lastIndexOf(",");
  const punto = t.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) {
    t = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (coma >= 0) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  }
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
}

function fechaIso(texto: string): string | null {
  const m = RE_FECHA.exec(texto.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function sinCerosIzquierda(digitos: string): string {
  return digitos.replace(/^0+(?=\d)/, "");
}

/** Items of one visual row, left to right. */
type Fila = TextoPdfItem[];

function agruparFilas(items: readonly TextoPdfItem[]): Fila[] {
  const ordenados = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const filas: Fila[] = [];
  for (const item of ordenados) {
    const fila = filas.at(-1);
    if (fila && Math.abs(fila[0]!.y - item.y) <= MISMA_FILA_PT) fila.push(item);
    else filas.push([item]);
  }
  return filas.map((fila) => fila.sort((a, b) => a.x - b.x));
}

/** The nearest item to the right of the first `etiqueta` (same row) that satisfies `valido`. */
function valorADerecha(items: readonly TextoPdfItem[], etiqueta: (s: string) => boolean, valido: (s: string) => boolean): string | null {
  const label = items.filter((i) => etiqueta(i.str.trim())).sort((a, b) => a.y - b.y)[0];
  if (!label) return null;
  const candidato = items
    .filter((i) => i !== label && i.x > label.x && Math.abs(i.y - label.y) <= MISMA_FILA_PT && valido(i.str.trim()))
    .sort((a, b) => a.x - b.x)[0];
  return candidato ? candidato.str.trim() : null;
}

/** The rightmost number on the row of the first item matching `etiqueta` (totals block). */
function importeDeFila(items: readonly TextoPdfItem[], etiqueta: (s: string) => boolean): string | null {
  const label = items.find((i) => etiqueta(i.str.trim()));
  if (!label) return null;
  const valor = items
    .filter((i) => i !== label && i.x > label.x && Math.abs(i.y - label.y) <= MISMA_FILA_PT && numeroFactura(i.str) !== null)
    .sort((a, b) => b.x - a.x)[0];
  return valor ? numeroFactura(valor.str) : null;
}

interface LoteLeido {
  lote: string;
  despacho: string | null;
  paisOrigen: string | null;
  fechaVencimiento: string | null;
}

/** "Desp.:23 001 IC04 163776 W L:307020 Orig:CHINA Envases:433/433" -> lote, despacho, origen. `null` if the row carries no "L:". */
function leerFilaLote(texto: string): LoteLeido | null {
  const lote = /(?:^|\s)L(?:ote)?:\s*(\S+)/i.exec(texto);
  if (!lote) return null;
  const despacho = /Desp\.?:\s*(.*?)\s+L(?:ote)?:/i.exec(texto)?.[1]?.trim() || null;
  const origen = /Orig(?:en)?\.?:\s*(.*?)(?=\s+\w+\.?:|$)/i.exec(texto)?.[1]?.trim() || null;
  const vto = /V(?:to|enc)\.?:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto)?.[1];
  return { lote: lote[1]!, despacho, paisOrigen: origen, fechaVencimiento: vto ? fechaIso(vto) : null };
}

/** Product row: code first, then description, unit, cantidad, precio, importe (the last three numeric). */
function leerFilaProducto(fila: Fila, advertencias: AdvertenciaParserFactura[]): Omit<ItemFacturaBorrador, "lotes"> | null {
  // Marker-only tokens ("**") are a column of their own: never part of the description.
  const textos = fila.map((i) => i.str.trim()).filter((t) => !/^\*+$/.test(t));
  if (!RE_CODIGO_PRODUCTO.test(textos[0] ?? "") || textos.length < 5) return null;
  const [cantidadLeida, precioLeido] = textos.slice(-3).map(numeroFactura);
  if (!cantidadLeida || !precioLeido) return null;
  const unidadLeida = textos.at(-4) ?? "";
  const descripcion = textos.slice(1, -4).join(" ").replace(/\s+/g, " ").replace(/,$/, "").trim();
  if (descripcion.length === 0 || numeroFactura(unidadLeida) !== null) return null;
  const drogaTexto = descripcion.replace(RE_MARCAS, "").replace(RE_PRESENTACION, "").trim();

  const multiplo = MULTIPLOS_UNIDAD[unidadLeida.toLowerCase().replace(/\.$/, "")];
  let cantidad = new Decimal(cantidadLeida);
  let precio = new Decimal(precioLeido);
  if (multiplo) {
    cantidad = cantidad.times(multiplo.factor);
    precio = precio.dividedBy(multiplo.factor);
    advertencias.push({
      codigo: "UNIDAD_CONVERTIDA",
      mensaje: `«${drogaTexto}» viene por ${multiplo.nombre} (${unidadLeida}): se cargó como ${cantidad.toString()} u a ${precio.toString()} c/u. Verificá el importe.`,
    });
  }
  return {
    codigo: textos[0]!,
    descripcion,
    drogaTexto,
    unidadTexto: multiplo ? "u" : unidadLeida,
    cantidad: cantidad.toString(),
    precioUnitario: precio.toDecimalPlaces(6).toString(),
  };
}

/** Splits `cantidad` among the lotes by container (row) count; the last lote takes the rounding remainder. */
function repartirPorEnvases(cantidad: string, envases: readonly number[]): string[] {
  const total = envases.reduce((a, b) => a + b, 0);
  const decimales = Math.max(3, cantidad.split(".")[1]?.length ?? 0);
  let asignado = new Decimal(0);
  return envases.map((n, i) => {
    if (i === envases.length - 1) return new Decimal(cantidad).minus(asignado).toString();
    const parte = new Decimal(cantidad).times(n).dividedBy(total).toDecimalPlaces(decimales, Decimal.ROUND_DOWN);
    asignado = asignado.plus(parte);
    return parte.toString();
  });
}

function leerItems(pages: readonly TextoPdfItem[][], advertencias: AdvertenciaParserFactura[]): ItemFacturaBorrador[] {
  const items: ItemFacturaBorrador[] = [];
  const lotesPorItem: { lote: LoteLeido; envases: number }[][] = [];

  for (const page of pages) {
    const encabezado = page.find((i) => /^Descripci[oó]n$/i.test(i.str.trim()));
    if (!encabezado) continue;
    const fin = page.filter((i) => i.y > encabezado.y && /^(Subtotal|Total Gravado:?|Transporte)/i.test(i.str.trim())).sort((a, b) => a.y - b.y)[0];
    const cuerpo = page.filter((i) => i.y > encabezado.y + MISMA_FILA_PT && (!fin || i.y < fin.y - MISMA_FILA_PT));

    for (const fila of agruparFilas(cuerpo)) {
      const producto = leerFilaProducto(fila, advertencias);
      if (producto) {
        items.push({ ...producto, lotes: [] });
        lotesPorItem.push([]);
        continue;
      }
      const lote = leerFilaLote(fila.map((i) => i.str.trim()).join(" "));
      const actuales = lotesPorItem.at(-1);
      if (!lote || !actuales) continue;
      const mismo = actuales.find((l) => l.lote.lote === lote.lote);
      if (mismo) mismo.envases += 1;
      else actuales.push({ lote, envases: 1 });
    }
  }

  items.forEach((item, i) => {
    const leidos = lotesPorItem[i]!;
    if (leidos.length === 0) {
      item.lotes = [{ lote: "", cantidad: item.cantidad, despacho: null, paisOrigen: null, fechaVencimiento: null }];
      advertencias.push({ codigo: "ITEM_SIN_LOTE", mensaje: `«${item.descripcion}» no trae lote en la factura: completalo.` });
      return;
    }
    const cantidades = leidos.length === 1 ? [item.cantidad] : repartirPorEnvases(item.cantidad, leidos.map((l) => l.envases));
    item.lotes = leidos.map((l, j) => ({ ...l.lote, cantidad: cantidades[j]! }));
    if (leidos.length > 1) {
      advertencias.push({
        codigo: "CANTIDAD_REPARTIDA",
        mensaje: `«${item.descripcion}» viene en ${leidos.length} lotes: la cantidad se repartió por envases. Verificala.`,
      });
    }
  });
  return items;
}

export function parsearFacturaCompraPdf(input: TextoPdf): ResultadoParserFactura {
  const primera = input.pages[0] ?? [];
  const todos = input.pages.flat();

  const nroComprobante = valorADerecha(primera, (s) => /^Factura:?$/i.test(s), (s) => /^\d{1,5}-\d{1,8}$/.test(s));
  if (!nroComprobante) return { ok: false, error: { mensaje: "No parece una factura de compra: no se encontró el número de comprobante." } };
  const [puntoVenta, numero] = nroComprobante.split("-").map(sinCerosIzquierda) as [string, string];

  const fecha = valorADerecha(primera, (s) => /^Fecha:?$/i.test(s), (s) => RE_FECHA.test(s));
  const fechaEmision = fecha ? fechaIso(fecha) : null;
  if (!fechaEmision) return { ok: false, error: { mensaje: "No se encontró la fecha de la factura." } };

  const advertencias: AdvertenciaParserFactura[] = [];
  const items = leerItems(input.pages, advertencias);
  if (items.length === 0) return { ok: false, error: { mensaje: "No se encontraron productos en la factura." } };

  const cuit = valorADerecha(primera, (s) => /^C\.?U\.?I\.?T\.?:?$/i.test(s), (s) => /^\d{2}-?\d{8}-?\d$/.test(s));
  const letra = primera.find((i) => /^[ABCM]$/.test(i.str.trim()) && i.y < 80)?.str.trim() ?? null;
  const cae = todos.map((i) => /C\.?A\.?E\.?\s*N?[º°o]?\s*:?\s*(\d{14})/i.exec(i.str)?.[1]).find(Boolean) ?? null;

  const faltantes = valorADerecha(todos, (s) => /^Faltantes:?$/i.test(s), () => true);
  if (faltantes) {
    advertencias.push({ codigo: "FALTANTES", mensaje: `La factura informa faltantes (no entregados, no se ingresan): ${faltantes.replace(/,$/, "")}.` });
  }

  return {
    ok: true,
    borrador: {
      emisorCuit: cuit ? cuit.replace(/-/g, "") : null,
      letra,
      puntoVenta,
      numero,
      fechaEmision,
      cae,
      subtotal: importeDeFila(todos, (s) => /^Subtotal$/i.test(s)),
      iva: importeDeFila(todos, (s) => /^Iva Inscr/i.test(s)),
      total: importeDeFila(todos, (s) => /^TOTAL:/i.test(s)),
      items,
    },
    advertencias,
  };
}
