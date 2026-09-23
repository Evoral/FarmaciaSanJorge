/**
 * PDF layout for a ficha técnica (M10, FASE 7 point 7.3). Pure rendering:
 * takes the already-authorized, already-loaded `FichaParaImprimir` (from
 * `getFichaParaImprimir`, which is the ONLY place patient data is read) and
 * lays it out with `pdfkit` via `shared/pdf/pdf-document.ts#renderPdf`.
 * Content per the task: pharmacy header (tenant), receta/item data,
 * paciente + prescriptor, weighing lines with quantities/units and which
 * lines are "enrase manual", version + generation timestamp, and space for
 * the preparer's signature.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { FichaParaImprimir } from "./ficha-repository";

const MARGIN_X = 40;
const PAGE_WIDTH = 595.28; // A4 points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function fechaHora(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Mendoza" }).format(d);
}

const COLS = [
  { key: "orden", label: "#", width: 24 },
  { key: "droga", label: "Droga", width: 190 },
  { key: "teorica", label: "Teórica", width: 70 },
  { key: "exceso", label: "Exceso %", width: 55 },
  { key: "aPesar", label: "A pesar", width: 75 },
  { key: "manual", label: "Enrase manual", width: 101 },
] as const;

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.font("Helvetica-Bold").fontSize(9);
  let x = MARGIN_X;
  for (const col of COLS) {
    doc.text(col.label, x, y, { width: col.width, align: col.key === "droga" ? "left" : "center" });
    x += col.width;
  }
  const bottom = y + 14;
  doc
    .moveTo(MARGIN_X, bottom)
    .lineTo(MARGIN_X + CONTENT_WIDTH, bottom)
    .lineWidth(0.75)
    .stroke();
  return bottom + 4;
}

function drawTableRow(doc: PDFKit.PDFDocument, y: number, linea: FichaParaImprimir["lineas"][number]): number {
  doc.font("Helvetica").fontSize(9);
  const values: Record<(typeof COLS)[number]["key"], string> = {
    orden: String(linea.orden + 1),
    droga: linea.drogaNombre,
    teorica: linea.cantidadTeorica ? `${linea.cantidadTeorica} ${linea.unidadSimbolo}` : "—",
    exceso: linea.excesoAplicado,
    aPesar: linea.cantidadAPesar ? `${linea.cantidadAPesar} ${linea.unidadSimbolo}` : "—",
    manual: linea.esEnraseManual ? "SÍ — a registrar al preparar" : "No",
  };
  let x = MARGIN_X;
  let maxHeight = 12;
  for (const col of COLS) {
    const height = doc.heightOfString(values[col.key], { width: col.width, align: col.key === "droga" ? "left" : "center" });
    maxHeight = Math.max(maxHeight, height);
  }
  for (const col of COLS) {
    doc.text(values[col.key], x, y, { width: col.width, align: col.key === "droga" ? "left" : "center" });
    x += col.width;
  }
  return y + maxHeight + 6;
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + needed > bottom) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

export function buildFichaTecnicaPdf(ficha: FichaParaImprimir): Promise<Buffer> {
  return renderPdf((doc) => {
    // ---- Encabezado de farmacia -------------------------------------------
    doc.font("Helvetica-Bold").fontSize(14).text(ficha.tenantNombreFantasia ?? ficha.tenantRazonSocial, MARGIN_X, doc.y);
    doc.font("Helvetica").fontSize(9);
    if (ficha.tenantNombreFantasia) doc.text(ficha.tenantRazonSocial);
    doc.text(`CUIT ${ficha.tenantCuit}${ficha.tenantMatriculaFarmacia ? ` — Matrícula de farmacia ${ficha.tenantMatriculaFarmacia}` : ""}`);
    if (ficha.tenantDomicilio) doc.text(ficha.tenantDomicilio);
    doc.moveDown(0.5);
    doc
      .moveTo(MARGIN_X, doc.y)
      .lineTo(MARGIN_X + CONTENT_WIDTH, doc.y)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.75);

    // ---- Título + versión ---------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(13).text(`Ficha técnica — versión ${ficha.version}`, MARGIN_X);
    doc.font("Helvetica").fontSize(9).text(`Generada el ${fechaHora(ficha.generadaEn)} por ${ficha.generadaPorNombre}`);
    doc.moveDown(0.75);

    // ---- Receta / ítem --------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(10).text("Receta");
    doc.font("Helvetica").fontSize(9);
    doc.text(`Receta interna Nº ${ficha.recetaNumeroInterno}`);
    doc.text(
      `Ítem: ${ficha.itemDescripcion ?? ficha.formaFarmaceutica} (${ficha.formaFarmaceutica}) — ${ficha.cantidadUnidades} unidad${ficha.cantidadUnidades === 1 ? "" : "es"}` +
        (ficha.cantidadTotal ? `, total ${ficha.cantidadTotal} ${ficha.unidadTotalSimbolo ?? ""}` : ""),
    );
    doc.moveDown(0.5);

    // ---- Paciente / prescriptor ------------------------------------------
    doc.font("Helvetica-Bold").fontSize(10).text("Paciente y prescriptor");
    doc.font("Helvetica").fontSize(9);
    doc.text(`Paciente: ${ficha.pacienteApellido}, ${ficha.pacienteNombre}`);
    doc.text(`Prescriptor: Dr./Dra. ${ficha.medicoApellido}, ${ficha.medicoNombre} — matrícula ${ficha.medicoMatricula}`);
    doc.moveDown(0.75);

    // ---- Líneas de pesaje ---------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(10).text("Líneas de pesaje");
    doc.moveDown(0.25);
    let y = drawTableHeader(doc, doc.y);
    for (const linea of ficha.lineas) {
      y = ensureSpace(doc, y, 30);
      if (y === doc.page.margins.top) y = drawTableHeader(doc, y);
      y = drawTableRow(doc, y, linea);
    }
    doc.y = y;

    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(8).text("Las líneas marcadas \"enrase manual\" no llevan cantidad congelada: su cantidad real la registra el farmacéutico al confirmar la preparación (docs/specs/ficha-tecnica.md).", {
      width: CONTENT_WIDTH,
    });

    // ---- Firma del preparador --------------------------------------------
    const firmaY = ensureSpace(doc, doc.y + 40, 90) + 40;
    doc
      .moveTo(MARGIN_X, firmaY)
      .lineTo(MARGIN_X + 220, firmaY)
      .moveTo(MARGIN_X + 260, firmaY)
      .lineTo(MARGIN_X + CONTENT_WIDTH, firmaY)
      .lineWidth(0.75)
      .stroke();
    doc.font("Helvetica").fontSize(9);
    doc.text("Firma del preparador", MARGIN_X, firmaY + 4, { width: 220, align: "center" });
    doc.text("Aclaración y matrícula", MARGIN_X + 260, firmaY + 4, { width: CONTENT_WIDTH - 260, align: "center" });
  });
}
