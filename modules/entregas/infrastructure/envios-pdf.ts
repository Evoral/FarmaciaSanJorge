/**
 * PDF "Hoja de envíos" of one repartidor (docs/specs/envios-repartidores.md, "PDF Hoja de envíos"): A4 landscape,
 * the envíos he carries that have not come back signed, with address, patient, payment state and room to sign.
 *
 * Unlike the libro recetario sheets (`shared/pdf/hojas.ts`, a legal document with its own neutral format), this sheet
 * follows the app's look (DESIGN.md): terracotta accent bar, serif title, cream summary cards, a cream table header with
 * hairline separators and zebra rows, and the payment state as a green/red pill. Only pdfkit's built-in fonts are used
 * (Times for the display title, Helvetica for the rest), so nothing is embedded (`shared/pdf/pdf-document.ts`).
 *
 * Layout: header and summary cards on the first sheet, a short continuation title on the next ones, the table header
 * repeated on every sheet, and a footer on every sheet with the farmacia, the repartidor and "Hoja i de n". The Importe
 * column exists only when the viewer holds `cotizaciones.ver` (E10).
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import { HOJA_ALTO, HOJA_ANCHO, HOJA_ANCHO_UTIL, HOJA_MARGEN, OPCIONES_HOJA_LIBRO } from "@/shared/pdf/hojas";
import { formatFechaHora } from "@/shared/format/fecha";
import { formatearMonto } from "@/shared/format/monto";
import { MENSAJE_HOJA_ENVIOS_VACIA, TEXTO_PAGO_IMPAGA, TEXTO_PAGO_PAGADA, textoFiltroHoja } from "../domain/hoja-envios";
import type { EnvioDeRepartidor, FarmaciaParaHoja, RepartidorDeEntrega } from "./entrega-repository";

export interface DatosHojaEnvios {
  farmacia: FarmaciaParaHoja;
  repartidor: RepartidorDeEntrega;
  /** YYYY-MM-DD filter, or null for every pending envío. */
  fecha: string | null;
  envios: readonly EnvioDeRepartidor[];
  /** The viewer holds `cotizaciones.ver`: print the Importe column (E10). */
  conImporte: boolean;
  zonaHoraria: string;
  generadaEn: Date;
  generadaPor: string;
}

// DESIGN.md color tokens (pdfkit takes hex only).
const COLOR = {
  primary: "#cc785c",
  primaryActive: "#a9583e",
  ink: "#141413",
  body: "#3d3d3a",
  bodyStrong: "#252523",
  muted: "#6c6a64",
  mutedSoft: "#8e8b82",
  hairline: "#e6dfd8",
  canvas: "#faf9f5",
  surfaceSoft: "#f5f0e8",
  surfaceCard: "#efe9de",
  // Pills: the success/error tokens, darkened for text and lightened for the background so they stay legible on paper.
  successText: "#2e7d46",
  successBg: "#e2f2e6",
  errorText: "#a83232",
  errorBg: "#f7e1e1",
} as const;

const FUENTE = { titulo: "Times-Roman", texto: "Helvetica", negrita: "Helvetica-Bold" } as const;

const PIE_Y = HOJA_ALTO - HOJA_MARGEN + 6;
/** Last y a table row may end at: leaves room for the footer. */
const LIMITE_INFERIOR = PIE_Y - 14;

const CELDA_PADDING_X = 6;
const CELDA_PADDING_Y = 8;
/** Room for the handwritten firma y aclaración of whoever receives. */
const ALTO_MINIMO_FILA = 44;
const TAMANO_TEXTO = 8.5;
const TAMANO_NOTA = 7;
const TAMANO_ROTULO = 6.5;

export type ClaveColumna = "receta" | "enviada" | "paciente" | "telefono" | "domicilio" | "preparados" | "pago" | "importe" | "recibio";

export interface ColumnaHojaEnvios {
  clave: ClaveColumna;
  label: string;
  width: number;
  align?: "left" | "center" | "right";
}

const ANCHO_RECIBIO = 140;
const ANCHO_IMPORTE = 84;

// Fixed widths; Domicilio takes whatever is left, so it grows when there is no Importe column.
const COLUMNAS_FIJAS: readonly ColumnaHojaEnvios[] = [
  { clave: "receta", label: "Receta", width: 46 },
  { clave: "enviada", label: "Enviada", width: 60 },
  { clave: "paciente", label: "Paciente", width: 110 },
  { clave: "telefono", label: "Teléfono", width: 66 },
  { clave: "preparados", label: "Preparados", width: 64, align: "center" },
  { clave: "pago", label: "Pago", width: 76 },
];

/** The table's columns, left to right: Importe only with `conImporte` (E10); Recibió last, wide enough to sign. They fill the usable width. */
export function columnasHojaEnvios(conImporte: boolean): ColumnaHojaEnvios[] {
  const fijas = COLUMNAS_FIJAS.reduce((total, c) => total + c.width, 0) + ANCHO_RECIBIO + (conImporte ? ANCHO_IMPORTE : 0);
  const porClave = new Map(COLUMNAS_FIJAS.map((c) => [c.clave, c]));
  const columnas: ColumnaHojaEnvios[] = [
    porClave.get("receta")!,
    porClave.get("enviada")!,
    porClave.get("paciente")!,
    porClave.get("telefono")!,
    { clave: "domicilio", label: "Domicilio", width: HOJA_ANCHO_UTIL - fijas },
    porClave.get("preparados")!,
    porClave.get("pago")!,
  ];
  if (conImporte) columnas.push({ clave: "importe", label: "Importe", width: ANCHO_IMPORTE, align: "right" });
  columnas.push({ clave: "recibio", label: "Recibió", width: ANCHO_RECIBIO });
  return columnas;
}

/** One envío as printed. `importe` is null when the column is not shown (no `cotizaciones.ver`). */
export interface FilaHojaEnvios {
  receta: string;
  fecha: string;
  hora: string;
  paciente: string;
  dni: string | null;
  telefono: string;
  domicilio: string;
  preparados: string;
  pagada: boolean;
  importe: { texto: string; nota?: string; sinCotizar?: boolean } | null;
}

function importeDe(envio: EnvioDeRepartidor): NonNullable<FilaHojaEnvios["importe"]> {
  if (envio.precio === null) return { texto: "Sin cotizar", sinCotizar: true };
  const texto = `$ ${formatearMonto(envio.precio)}`;
  return envio.precioIncompleto ? { texto, nota: "incompleto" } : { texto };
}

/** One row per envío, in the given order. */
export function filasHojaEnvios(envios: readonly EnvioDeRepartidor[], conImporte: boolean, zonaHoraria: string): FilaHojaEnvios[] {
  return envios.map((e) => {
    const [fecha = "", hora = ""] = formatFechaHora(e.entregadaEn, zonaHoraria).split(" ");
    return {
      receta: `Nº ${e.numeroInterno}`,
      fecha,
      hora,
      paciente: `${e.pacienteApellido}, ${e.pacienteNombre}`,
      dni: e.pacienteDni ? `DNI ${e.pacienteDni}` : null,
      telefono: e.pacienteTelefono || "—",
      domicilio: e.domicilio || "—",
      preparados: String(e.itemsPreparados),
      pagada: e.pagada,
      importe: conImporte ? importeDe(e) : null,
    };
  });
}

function lineaTelefonos(fijo: string | null, celular: string | null): string | null {
  const partes = [fijo ? `Tel. ${fijo}` : null, celular ? `Cel. ${celular}` : null].filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join("  ·  ") : null;
}

type Doc = PDFKit.PDFDocument;

function barraAcento(doc: Doc): void {
  doc.save().rect(0, 0, HOJA_ANCHO, 5).fill(COLOR.primary).restore();
}

function rotulo(doc: Doc, texto: string, x: number, y: number, width: number, color: string = COLOR.muted, align: "left" | "center" | "right" = "left", characterSpacing = 0.8): void {
  doc.font(FUENTE.negrita).fontSize(TAMANO_ROTULO).fillColor(color).text(texto.toUpperCase(), x, y, { width, align, characterSpacing, lineBreak: false });
}

/** First-sheet header: farmacia eyebrow + phones, serif title, generation line. Leaves `doc.y` under it. */
function encabezado(doc: Doc, datos: DatosHojaEnvios): void {
  const x0 = HOJA_MARGEN;
  const y0 = HOJA_MARGEN - 6;
  rotulo(doc, datos.farmacia.nombre, x0, y0, HOJA_ANCHO_UTIL / 2, COLOR.primaryActive);
  const telefonos = lineaTelefonos(datos.farmacia.telefonoFijo, datos.farmacia.telefonoCelular);
  if (telefonos) doc.font(FUENTE.texto).fontSize(TAMANO_NOTA + 0.5).fillColor(COLOR.muted).text(telefonos, x0 + HOJA_ANCHO_UTIL / 2, y0 - 1, { width: HOJA_ANCHO_UTIL / 2, align: "right", lineBreak: false });

  doc.font(FUENTE.titulo).fontSize(26).fillColor(COLOR.ink).text("Hoja de envíos", x0, y0 + 14, { lineBreak: false });
  doc
    .font(FUENTE.texto)
    .fontSize(TAMANO_NOTA + 0.5)
    .fillColor(COLOR.muted)
    .text(`Generada el ${formatFechaHora(datos.generadaEn, datos.zonaHoraria)} por ${datos.generadaPor}`, x0, y0 + 46, { lineBreak: false });
  doc.y = y0 + 64;
}

/** A cream card with a small label and a value; returns nothing, draws at (x, y). */
function tarjeta(doc: Doc, x: number, y: number, width: number, alto: number, etiqueta: string, dibujarValor: (xi: number, yi: number, wi: number) => void): void {
  doc.save().roundedRect(x, y, width, alto, 6).fill(COLOR.surfaceCard).restore();
  rotulo(doc, etiqueta, x + 12, y + 10, width - 24);
  dibujarValor(x + 12, y + 22, width - 24);
}

/** Repartidor, filter, envíos and "a cobrar" cards across the page. Leaves `doc.y` under them. */
function tarjetasResumen(doc: Doc, datos: DatosHojaEnvios): void {
  const y = doc.y;
  const alto = 52;
  const gap = 10;
  const anchos = [290, 200];
  const anchoNumero = (HOJA_ANCHO_UTIL - anchos[0]! - anchos[1]! - 3 * gap) / 2;
  const impagas = datos.envios.filter((e) => !e.pagada).length;
  let x = HOJA_MARGEN;

  tarjeta(doc, x, y, anchos[0]!, alto, "Repartidor", (xi, yi, wi) => {
    doc.font(FUENTE.negrita).fontSize(12).fillColor(COLOR.ink).text(`${datos.repartidor.apellido}, ${datos.repartidor.nombre}`, xi, yi, { width: wi, lineBreak: false, ellipsis: true });
    doc.font(FUENTE.texto).fontSize(TAMANO_TEXTO).fillColor(COLOR.body).text(`Tel. ${datos.repartidor.telefono}`, xi, yi + 16, { width: wi, lineBreak: false });
  });
  x += anchos[0]! + gap;

  tarjeta(doc, x, y, anchos[1]!, alto, "Filtro", (xi, yi, wi) => {
    const filtro = textoFiltroHoja(datos.fecha);
    const [titulo, valor] = filtro.includes(": ") ? filtro.split(": ") : [filtro, null];
    doc.font(FUENTE.negrita).fontSize(12).fillColor(COLOR.ink).text(valor ?? titulo!, xi, yi, { width: wi, lineBreak: false });
    doc.font(FUENTE.texto).fontSize(TAMANO_TEXTO).fillColor(COLOR.body).text(valor ? titulo! : "Sin filtro de fecha", xi, yi + 16, { width: wi, lineBreak: false });
  });
  x += anchos[1]! + gap;

  tarjeta(doc, x, y, anchoNumero, alto, "Envíos", (xi, yi, wi) => {
    doc.font(FUENTE.titulo).fontSize(22).fillColor(COLOR.ink).text(String(datos.envios.length), xi, yi - 2, { width: wi, lineBreak: false });
  });
  x += anchoNumero + gap;

  tarjeta(doc, x, y, anchoNumero, alto, "A cobrar", (xi, yi, wi) => {
    doc.font(FUENTE.titulo).fontSize(22).fillColor(impagas > 0 ? COLOR.errorText : COLOR.ink).text(String(impagas), xi, yi - 2, { width: wi, lineBreak: false });
  });

  doc.y = y + alto + 16;
}

/** Continuation sheets: accent bar and a one-line title. */
function encabezadoContinuacion(doc: Doc, datos: DatosHojaEnvios): void {
  barraAcento(doc);
  doc.font(FUENTE.titulo).fontSize(14).fillColor(COLOR.ink).text("Hoja de envíos", HOJA_MARGEN, HOJA_MARGEN - 6, { continued: true, lineBreak: false });
  doc.font(FUENTE.texto).fontSize(TAMANO_TEXTO).fillColor(COLOR.muted).text(`   ${datos.repartidor.apellido}, ${datos.repartidor.nombre} · continuación`, { lineBreak: false });
  doc.y = HOJA_MARGEN + 18;
}

function encabezadoTabla(doc: Doc, columnas: readonly ColumnaHojaEnvios[]): void {
  const y = doc.y;
  const alto = 22;
  doc.save().roundedRect(HOJA_MARGEN, y, HOJA_ANCHO_UTIL, alto, 4).fill(COLOR.surfaceSoft).restore();
  let x = HOJA_MARGEN;
  for (const col of columnas) {
    // Tighter spacing than the cards' labels: the narrow columns' labels must fit on one line.
    rotulo(doc, col.label, x + CELDA_PADDING_X, y + 8, col.width - 2 * CELDA_PADDING_X, COLOR.muted, col.align ?? "left", 0.4);
    x += col.width;
  }
  doc.y = y + alto;
}

/** Text (and optional smaller note below) of a plain cell, for measuring and drawing alike. */
interface TextoCelda {
  texto: string;
  nota?: string | null;
  negrita?: boolean;
  color?: string;
  colorNota?: string;
}

function textoDeCelda(fila: FilaHojaEnvios, clave: ClaveColumna): TextoCelda | null {
  switch (clave) {
    case "receta":
      return { texto: fila.receta, negrita: true, color: COLOR.ink };
    case "enviada":
      return { texto: fila.fecha, nota: fila.hora };
    case "paciente":
      return { texto: fila.paciente, nota: fila.dni, negrita: true, color: COLOR.bodyStrong };
    case "telefono":
      return { texto: fila.telefono };
    case "domicilio":
      return { texto: fila.domicilio, color: COLOR.bodyStrong };
    case "preparados":
      return { texto: fila.preparados, negrita: true, color: COLOR.ink };
    case "importe":
      return fila.importe
        ? { texto: fila.importe.texto, nota: fila.importe.nota, negrita: !fila.importe.sinCotizar, color: fila.importe.sinCotizar ? COLOR.mutedSoft : COLOR.ink }
        : null;
    case "pago":
    case "recibio":
      return null; // drawn by hand
  }
}

function altoTexto(doc: Doc, celda: TextoCelda, ancho: number): number {
  doc.font(celda.negrita ? FUENTE.negrita : FUENTE.texto).fontSize(TAMANO_TEXTO);
  let alto = doc.heightOfString(celda.texto || " ", { width: ancho });
  if (celda.nota) {
    doc.font(FUENTE.texto).fontSize(TAMANO_NOTA);
    alto += 2 + doc.heightOfString(celda.nota, { width: ancho });
  }
  return alto;
}

function dibujarTexto(doc: Doc, celda: TextoCelda, x: number, y: number, ancho: number, align: "left" | "center" | "right"): void {
  doc
    .font(celda.negrita ? FUENTE.negrita : FUENTE.texto)
    .fontSize(TAMANO_TEXTO)
    .fillColor(celda.color ?? COLOR.body)
    .text(celda.texto, x, y, { width: ancho, align });
  if (celda.nota) doc.font(FUENTE.texto).fontSize(TAMANO_NOTA).fillColor(celda.colorNota ?? COLOR.muted).text(celda.nota, x, doc.y + 2, { width: ancho, align });
}

/** Payment pill ("PAGADA" green / "IMPAGA" red) with "Cobrar al entregar" under an unpaid one. */
function dibujarPago(doc: Doc, pagada: boolean, x: number, y: number, ancho: number): void {
  const texto = (pagada ? TEXTO_PAGO_PAGADA : TEXTO_PAGO_IMPAGA.split(" — ")[0]!).toUpperCase();
  doc.font(FUENTE.negrita).fontSize(TAMANO_ROTULO + 0.5);
  const anchoPastilla = doc.widthOfString(texto, { characterSpacing: 0.6 }) + 14;
  doc.save().roundedRect(x, y - 2, anchoPastilla, 14, 7).fill(pagada ? COLOR.successBg : COLOR.errorBg).restore();
  doc.fillColor(pagada ? COLOR.successText : COLOR.errorText).text(texto, x + 7, y + 1.5, { characterSpacing: 0.6, lineBreak: false });
  if (!pagada) doc.font(FUENTE.texto).fontSize(TAMANO_NOTA).fillColor(COLOR.errorText).text("Cobrar al entregar", x, y + 16, { width: ancho, lineBreak: false });
}

/** Signature line with its caption at the bottom of the Recibió cell. */
function dibujarFirma(doc: Doc, x: number, yFondo: number, ancho: number): void {
  const yLinea = yFondo - 15;
  doc.save().moveTo(x, yLinea).lineTo(x + ancho, yLinea).lineWidth(0.6).strokeColor(COLOR.mutedSoft).dash(1.5, { space: 1.5 }).stroke().undash().restore();
  doc.font(FUENTE.texto).fontSize(TAMANO_ROTULO).fillColor(COLOR.mutedSoft).text("Firma y aclaración", x, yLinea + 3, { width: ancho, lineBreak: false });
}

function dibujarTabla(doc: Doc, datos: DatosHojaEnvios): void {
  const columnas = columnasHojaEnvios(datos.conImporte);
  const filas = filasHojaEnvios(datos.envios, datos.conImporte, datos.zonaHoraria);
  encabezadoTabla(doc, columnas);

  filas.forEach((fila, indice) => {
    const altoContenido = Math.max(
      ...columnas.map((col) => {
        const celda = textoDeCelda(fila, col.clave);
        if (celda) return altoTexto(doc, celda, col.width - 2 * CELDA_PADDING_X);
        return col.clave === "pago" && !fila.pagada ? 24 : 12;
      }),
    );
    const alto = Math.max(ALTO_MINIMO_FILA, altoContenido + 2 * CELDA_PADDING_Y);

    if (doc.y + alto > LIMITE_INFERIOR) {
      doc.addPage();
      encabezadoContinuacion(doc, datos);
      encabezadoTabla(doc, columnas);
    }

    const y = doc.y;
    if (indice % 2 === 1) doc.save().rect(HOJA_MARGEN, y, HOJA_ANCHO_UTIL, alto).fill(COLOR.canvas).restore();

    let x = HOJA_MARGEN;
    for (const col of columnas) {
      const xi = x + CELDA_PADDING_X;
      const ancho = col.width - 2 * CELDA_PADDING_X;
      const celda = textoDeCelda(fila, col.clave);
      if (celda) dibujarTexto(doc, celda, xi, y + CELDA_PADDING_Y, ancho, col.align ?? "left");
      else if (col.clave === "pago") dibujarPago(doc, fila.pagada, xi, y + CELDA_PADDING_Y, ancho);
      else if (col.clave === "recibio") dibujarFirma(doc, xi, y + alto, ancho);
      x += col.width;
    }

    doc.save().moveTo(HOJA_MARGEN, y + alto).lineTo(HOJA_MARGEN + HOJA_ANCHO_UTIL, y + alto).lineWidth(0.6).strokeColor(COLOR.hairline).stroke().restore();
    doc.y = y + alto;
  });
}

/** Under the table: what "IMPAGA" means for the repartidor. */
function leyenda(doc: Doc, datos: DatosHojaEnvios): void {
  if (!datos.envios.some((e) => !e.pagada)) return;
  if (doc.y + 24 > LIMITE_INFERIOR) {
    doc.addPage();
    encabezadoContinuacion(doc, datos);
  }
  doc
    .font(FUENTE.texto)
    .fontSize(TAMANO_NOTA + 0.5)
    .fillColor(COLOR.muted)
    .text("Los envíos marcados IMPAGA se cobran al entregar. Pida firma y aclaración de quien recibe en cada envío.", HOJA_MARGEN, doc.y + 10, { width: HOJA_ANCHO_UTIL });
}

function vacio(doc: Doc): void {
  const y = doc.y;
  doc.save().roundedRect(HOJA_MARGEN, y, HOJA_ANCHO_UTIL, 70, 6).fill(COLOR.surfaceSoft).restore();
  doc.font(FUENTE.texto).fontSize(10).fillColor(COLOR.muted).text(MENSAJE_HOJA_ENVIOS_VACIA, HOJA_MARGEN, y + 30, { width: HOJA_ANCHO_UTIL, align: "center", lineBreak: false });
  doc.y = y + 70;
}

/** Footer of every sheet: farmacia · repartidor on the left, "Hoja i de n" on the right, over a hairline. */
function pies(doc: Doc, datos: DatosHojaEnvios): void {
  const rango = doc.bufferedPageRange();
  const total = rango.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(rango.start + i);
    // Writing below the bottom margin would make pdfkit add a page: lift the margin while drawing the footer.
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save().moveTo(HOJA_MARGEN, PIE_Y - 6).lineTo(HOJA_MARGEN + HOJA_ANCHO_UTIL, PIE_Y - 6).lineWidth(0.6).strokeColor(COLOR.hairline).stroke().restore();
    doc
      .font(FUENTE.texto)
      .fontSize(TAMANO_NOTA)
      .fillColor(COLOR.mutedSoft)
      .text(`${datos.farmacia.nombre}  ·  Hoja de envíos  ·  ${datos.repartidor.apellido}, ${datos.repartidor.nombre}`, HOJA_MARGEN, PIE_Y, { width: HOJA_ANCHO_UTIL * 0.7, lineBreak: false });
    doc.text(`Hoja ${i + 1} de ${total}`, HOJA_MARGEN, PIE_Y, { width: HOJA_ANCHO_UTIL, align: "right", lineBreak: false });
    doc.page.margins.bottom = margenInferior;
  }
}

export function buildEnviosPdf(datos: DatosHojaEnvios): Promise<Buffer> {
  return renderPdf((doc) => {
    barraAcento(doc);
    encabezado(doc, datos);
    tarjetasResumen(doc, datos);
    if (datos.envios.length === 0) vacio(doc);
    else {
      dibujarTabla(doc, datos);
      leyenda(doc, datos);
    }
    pies(doc, datos);
  }, OPCIONES_HOJA_LIBRO);
}
