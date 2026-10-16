/**
 * Sheet layout shared by the printed libro recetario (docs/specs/libro-recetario-y-contralor.md, "Impresión"):
 * A4 landscape, one jornada per sheet group -- a day may take several sheets, two days never share one -- and a
 * "Hoja i de n" footer numbered within each day. Requires the document to be created with `bufferPages: true`
 * (`renderPdf(build, OPCIONES_HOJA_LIBRO)`), since the totals are only known once every page exists.
 *
 * `dibujarTabla` draws the asientos: every cell WRAPS (nothing is cut -- the libro must show the whole fórmula),
 * so each row is as tall as its tallest cell; a row that does not fit moves to a new sheet with the header repeated.
 */
export const OPCIONES_HOJA_LIBRO: PDFKit.PDFDocumentOptions = { layout: "landscape", bufferPages: true };

export const HOJA_MARGEN = 40;
/** A4 landscape, in points. */
export const HOJA_ANCHO = 842;
export const HOJA_ALTO = 595;
/** Usable width between margins (762 pt). */
export const HOJA_ANCHO_UTIL = HOJA_ANCHO - 2 * HOJA_MARGEN;
/** Last y a table row may end at: leaves room for the footer. */
export const HOJA_LIMITE_INFERIOR = HOJA_ALTO - HOJA_MARGEN - 14;

const PADDING_X = 5;
const PADDING_Y = 4;
const TAMANO_TEXTO = 8;
const COLOR_BORDE = "#d4d4d8";
const COLOR_ENCABEZADO = "#f4f4f5";
const COLOR_TEXTO_SECUNDARIO = "#52525b";

export interface ColumnaTabla {
  label: string;
  width: number;
  align?: "left" | "right";
}

/** One cell: the main text, plus an optional smaller grey line below it (e.g. "Rectifica Nº 12"). */
export type CeldaTabla = string | { texto: string; nota?: string };

function partes(celda: CeldaTabla): { texto: string; nota?: string } {
  return typeof celda === "string" ? { texto: celda } : celda;
}

function altoCelda(doc: PDFKit.PDFDocument, celda: CeldaTabla, ancho: number): number {
  const { texto, nota } = partes(celda);
  doc.font("Helvetica").fontSize(TAMANO_TEXTO);
  let alto = doc.heightOfString(texto || " ", { width: ancho });
  if (nota) {
    doc.fontSize(TAMANO_TEXTO - 1);
    alto += 1 + doc.heightOfString(nota, { width: ancho });
  }
  return alto;
}

function lineaHorizontal(doc: PDFKit.PDFDocument, y: number, ancho: number): void {
  doc.save().moveTo(HOJA_MARGEN, y).lineTo(HOJA_MARGEN + ancho, y).lineWidth(0.5).strokeColor(COLOR_BORDE).stroke().restore();
}

function dibujarEncabezado(doc: PDFKit.PDFDocument, columnas: readonly ColumnaTabla[], ancho: number): void {
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(TAMANO_TEXTO);
  const alto = Math.max(...columnas.map((c) => doc.heightOfString(c.label, { width: c.width - 2 * PADDING_X }))) + 2 * PADDING_Y;
  doc.save().rect(HOJA_MARGEN, y, ancho, alto).fill(COLOR_ENCABEZADO).restore();
  let x = HOJA_MARGEN;
  for (const col of columnas) {
    doc.fillColor("#18181b").text(col.label, x + PADDING_X, y + PADDING_Y, { width: col.width - 2 * PADDING_X, align: col.align ?? "left" });
    x += col.width;
  }
  lineaHorizontal(doc, y + alto, ancho);
  doc.y = y + alto;
}

/**
 * Draws `filas` under the current `doc.y`. `alNuevaHoja` writes the continuation title of the new sheet (it must
 * leave `doc.y` where the table goes on); the column header is repeated by this function.
 */
export function dibujarTabla(doc: PDFKit.PDFDocument, columnas: readonly ColumnaTabla[], filas: readonly CeldaTabla[][], alNuevaHoja: () => void): void {
  const ancho = columnas.reduce((total, c) => total + c.width, 0);
  dibujarEncabezado(doc, columnas, ancho);

  for (const fila of filas) {
    const alto = Math.max(...columnas.map((col, i) => altoCelda(doc, fila[i] ?? "", col.width - 2 * PADDING_X))) + 2 * PADDING_Y;
    if (doc.y + alto > HOJA_LIMITE_INFERIOR) {
      doc.addPage();
      alNuevaHoja();
      dibujarEncabezado(doc, columnas, ancho);
    }

    const y = doc.y;
    let x = HOJA_MARGEN;
    columnas.forEach((col, i) => {
      const { texto, nota } = partes(fila[i] ?? "");
      const opciones = { width: col.width - 2 * PADDING_X, align: col.align ?? "left" } as const;
      doc.font("Helvetica").fontSize(TAMANO_TEXTO).fillColor("#18181b").text(texto, x + PADDING_X, y + PADDING_Y, opciones);
      if (nota) doc.fontSize(TAMANO_TEXTO - 1).fillColor(COLOR_TEXTO_SECUNDARIO).text(nota, x + PADDING_X, doc.y + 1, opciones);
      x += col.width;
    });
    lineaHorizontal(doc, y + alto, ancho);
    doc.fillColor("black");
    doc.y = y + alto;
  }
}

/** The stored fórmula text with each ítem on its own line (`Ítem 1: …` / `Ítem 2: …`, joined by " | " in the asiento). */
export function formulaParaHoja(formulaTexto: string): string {
  return formulaTexto.split(" | ").join("\n");
}

/** The page indexes (0-based, both inclusive) of one jornada and the label its footer repeats. */
export interface GrupoDeHojas {
  primera: number;
  ultima: number;
  etiqueta: string;
}

/** Writes "<etiqueta> — Hoja i de n" at the bottom of every page, numbered within its group. Call once, after the last page. */
export function numerarHojas(doc: PDFKit.PDFDocument, grupos: readonly GrupoDeHojas[]): void {
  for (const grupo of grupos) {
    const total = grupo.ultima - grupo.primera + 1;
    for (let pagina = grupo.primera; pagina <= grupo.ultima; pagina++) {
      doc.switchToPage(pagina);
      // Writing below the bottom margin would make pdfkit add a page: lift the margin while drawing the footer.
      const margenInferior = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(COLOR_TEXTO_SECUNDARIO)
        .text(`${grupo.etiqueta} — Hoja ${pagina - grupo.primera + 1} de ${total}`, HOJA_MARGEN, HOJA_ALTO - HOJA_MARGEN, { width: HOJA_ANCHO_UTIL, align: "right", lineBreak: false })
        .fillColor("black");
      doc.page.margins.bottom = margenInferior;
    }
  }
}
