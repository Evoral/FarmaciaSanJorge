/**
 * PDF "Hoja de envíos" of one repartidor (openspec/specs/envios-repartidores/spec.md, "PDF Hoja de envíos"): A4 landscape,
 * the envíos he carries that have not come back signed, with address, patient, payment state and room to sign.
 *
 * Unlike the libro recetario sheets (`shared/pdf/hojas.ts`, a legal document with its own neutral format), this sheet
 * wears the app's skin, visual identity 1a "Clínico" (`app/globals.css`): white surfaces, cool green-tinted neutrals,
 * the logo's green as the only brand color, 4-6 pt radii. The logo (`shared/pdf/logo.ts`) heads the first sheet over a
 * brand-green band; summary cards and the table look like the app's `.card` and `.data-table`, and the payment state is
 * a `StatusBadge`-like pill. pdfkit's built-in Helvetica stands in for IBM Plex Sans (nothing is embedded).
 *
 * Layout: header and summary cards on the first sheet, a short continuation header on the next ones, the table (with
 * its header) framed as a card on every sheet, and a footer on every sheet with the farmacia, the repartidor and
 * "Hoja i de n". The Importe column exists only when the viewer holds `cotizaciones.ver` (E10).
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import { HOJA_ALTO, HOJA_ANCHO, HOJA_ANCHO_UTIL, HOJA_MARGEN, OPCIONES_HOJA_LIBRO } from "@/shared/pdf/hojas";
import type { LogoPdf } from "@/shared/pdf/logo";
import { formatFechaHora } from "@/shared/format/fecha";
import { formatearMonto } from "@/shared/format/monto";
import { MENSAJE_HOJA_ENVIOS_VACIA, TEXTO_PAGO_PAGADA, textoFiltroHoja } from "../domain/hoja-envios";
import type { EnvioDeRepartidor, FarmaciaParaHoja, RepartidorDeEntrega } from "./entrega-repository";

export interface DatosHojaEnvios {
  farmacia: FarmaciaParaHoja;
  /** The tenant's own logo (`shared/pdf/logo.ts`); null = the farmacia's name instead. */
  logo: LogoPdf | null;
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

// Identity 1a "Clínico" tokens (app/globals.css @theme; pdfkit takes hex only).
const COLOR = {
  brand: "#03b386", // --color-brand / emerald-500
  primary: "#037a5c", // --color-primary / emerald-700
  ink: "#0f1a17", // zinc-900
  bodyStrong: "#232c29", // zinc-800
  body: "#36403d", // zinc-700
  muted: "#65746f", // zinc-500
  mutedSoft: "#97a5a0", // zinc-400
  border: "#e2e8e6", // zinc-200
  borderSoft: "#eef1f0", // zinc-100
  canvas: "#f5f7f7", // zinc-50
  successBg: "#e7f5f0", // emerald-50
  successText: "#037a5c", // emerald-700
  dangerBg: "#fdecea", // red-50
  dangerText: "#b42318", // --color-danger / red-600
} as const;

const FUENTE = { texto: "Helvetica", negrita: "Helvetica-Bold" } as const;
const RADIO_CARD = 6; // --radius-lg
const RADIO_BADGE = 4; // --radius-sm

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

/** Brand band across the top edge: the logo's green fading into the primary green. */
function bandaMarca(doc: Doc): void {
  const degradado = doc.linearGradient(0, 0, HOJA_ANCHO, 0).stop(0, COLOR.brand).stop(1, COLOR.primary);
  doc.save().rect(0, 0, HOJA_ANCHO, 6).fill(degradado).restore();
}

function rotulo(doc: Doc, texto: string, x: number, y: number, width: number, align: "left" | "center" | "right" = "left", characterSpacing = 0.5): void {
  doc.font(FUENTE.negrita).fontSize(TAMANO_ROTULO).fillColor(COLOR.muted).text(texto.toUpperCase(), x, y, { width, align, characterSpacing, lineBreak: false });
}

function lineaHorizontal(doc: Doc, y: number, color: string, x = HOJA_MARGEN, ancho = HOJA_ANCHO_UTIL): void {
  doc.save().moveTo(x, y).lineTo(x + ancho, y).lineWidth(0.75).strokeColor(color).stroke().restore();
}

/** The logo at (x, y) with the given height; without one, the farmacia's name in bold. Returns its width. */
function dibujarLogo(doc: Doc, logo: LogoPdf | null, nombreFarmacia: string, x: number, y: number, alto: number): number {
  if (logo) {
    doc.image(logo.imagen, x, y, { height: alto });
    return alto * logo.proporcion;
  }
  doc.font(FUENTE.negrita).fontSize(alto * 0.45).fillColor(COLOR.primary).text(nombreFarmacia, x, y + alto * 0.25, { lineBreak: false });
  return doc.widthOfString(nombreFarmacia);
}

/** First-sheet header: logo on the left; title, phones and generation on the right; a hairline under both. */
function encabezado(doc: Doc, datos: DatosHojaEnvios): void {
  const y0 = HOJA_MARGEN - 10;
  dibujarLogo(doc, datos.logo, datos.farmacia.nombre, HOJA_MARGEN, y0, 40);

  const xDerecha = HOJA_MARGEN + HOJA_ANCHO_UTIL / 2;
  const anchoDerecha = HOJA_ANCHO_UTIL / 2;
  doc.font(FUENTE.negrita).fontSize(18).fillColor(COLOR.ink).text("Hoja de envíos", xDerecha, y0 + 2, { width: anchoDerecha, align: "right", lineBreak: false });
  const telefonos = lineaTelefonos(datos.farmacia.telefonoFijo, datos.farmacia.telefonoCelular);
  doc
    .font(FUENTE.texto)
    .fontSize(TAMANO_NOTA + 1)
    .fillColor(COLOR.body)
    .text(telefonos ? `${datos.farmacia.nombre}  ·  ${telefonos}` : datos.farmacia.nombre, xDerecha, y0 + 25, { width: anchoDerecha, align: "right", lineBreak: false });
  doc
    .fontSize(TAMANO_NOTA)
    .fillColor(COLOR.muted)
    .text(`Generada el ${formatFechaHora(datos.generadaEn, datos.zonaHoraria)} por ${datos.generadaPor}`, xDerecha, y0 + 38, { width: anchoDerecha, align: "right", lineBreak: false });

  lineaHorizontal(doc, y0 + 54, COLOR.border);
  doc.y = y0 + 66;
}

/** A white card with a hairline border (`.card`); `acento` adds the brand bar on its left edge. */
function tarjeta(doc: Doc, x: number, y: number, width: number, alto: number, etiqueta: string, dibujarValor: (xi: number, yi: number, wi: number) => void, acento = false): void {
  doc.save().roundedRect(x, y, width, alto, RADIO_CARD).lineWidth(0.75).fillAndStroke("#ffffff", COLOR.border).restore();
  if (acento) {
    doc.save().roundedRect(x, y, width, alto, RADIO_CARD).clip().rect(x, y, 3, alto).fill(COLOR.brand).restore();
  }
  const xi = x + (acento ? 15 : 12);
  rotulo(doc, etiqueta, xi, y + 10, width - 24);
  dibujarValor(xi, y + 22, width - 24);
}

/** Repartidor, filter, envíos and "a cobrar" cards across the page. Leaves `doc.y` under them. */
function tarjetasResumen(doc: Doc, datos: DatosHojaEnvios): void {
  const y = doc.y;
  const alto = 50;
  const gap = 10;
  const anchoRepartidor = 290;
  const anchoFiltro = 200;
  const anchoNumero = (HOJA_ANCHO_UTIL - anchoRepartidor - anchoFiltro - 3 * gap) / 2;
  const impagas = datos.envios.filter((e) => !e.pagada).length;
  let x = HOJA_MARGEN;

  tarjeta(
    doc,
    x,
    y,
    anchoRepartidor,
    alto,
    "Repartidor",
    (xi, yi, wi) => {
      doc.font(FUENTE.negrita).fontSize(12).fillColor(COLOR.ink).text(`${datos.repartidor.apellido}, ${datos.repartidor.nombre}`, xi, yi, { width: wi, lineBreak: false, ellipsis: true });
      doc.font(FUENTE.texto).fontSize(TAMANO_TEXTO).fillColor(COLOR.body).text(`Tel. ${datos.repartidor.telefono}`, xi, yi + 15, { width: wi, lineBreak: false });
    },
    true,
  );
  x += anchoRepartidor + gap;

  tarjeta(doc, x, y, anchoFiltro, alto, "Fecha de envío", (xi, yi, wi) => {
    const filtro = textoFiltroHoja(datos.fecha);
    const valor = filtro.includes(": ") ? filtro.split(": ")[1]! : filtro;
    doc.font(FUENTE.negrita).fontSize(12).fillColor(COLOR.ink).text(valor, xi, yi, { width: wi, lineBreak: false });
    doc.font(FUENTE.texto).fontSize(TAMANO_TEXTO).fillColor(COLOR.muted).text(datos.fecha ? "Envíos pendientes de ese día" : "Sin filtro de fecha", xi, yi + 15, { width: wi, lineBreak: false });
  });
  x += anchoFiltro + gap;

  tarjeta(doc, x, y, anchoNumero, alto, "Envíos", (xi, yi, wi) => {
    doc.font(FUENTE.negrita).fontSize(20).fillColor(COLOR.ink).text(String(datos.envios.length), xi, yi - 1, { width: wi, lineBreak: false });
  });
  x += anchoNumero + gap;

  tarjeta(doc, x, y, anchoNumero, alto, "A cobrar", (xi, yi, wi) => {
    doc.font(FUENTE.negrita).fontSize(20).fillColor(impagas > 0 ? COLOR.dangerText : COLOR.ink).text(String(impagas), xi, yi - 1, { width: wi, lineBreak: false });
  });

  doc.y = y + alto + 14;
}

/** Continuation sheets: brand band, small logo and a one-line title. */
function encabezadoContinuacion(doc: Doc, datos: DatosHojaEnvios): void {
  bandaMarca(doc);
  const y0 = HOJA_MARGEN - 12;
  dibujarLogo(doc, datos.logo, datos.farmacia.nombre, HOJA_MARGEN, y0, 24);
  doc
    .font(FUENTE.negrita)
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text(`Hoja de envíos  ·  ${datos.repartidor.apellido}, ${datos.repartidor.nombre}`, HOJA_MARGEN + HOJA_ANCHO_UTIL / 2, y0 + 4, { width: HOJA_ANCHO_UTIL / 2, align: "right", lineBreak: false });
  doc.font(FUENTE.texto).fontSize(TAMANO_NOTA).fillColor(COLOR.muted).text("continuación", HOJA_MARGEN + HOJA_ANCHO_UTIL / 2, y0 + 17, { width: HOJA_ANCHO_UTIL / 2, align: "right", lineBreak: false });
  doc.y = y0 + 36;
}

const ALTO_ENCABEZADO_TABLA = 22;

/** The `.data-table` thead: zinc-50 band (rounded top corners, the table is framed as a card) and uppercase labels. */
function encabezadoTabla(doc: Doc, columnas: readonly ColumnaHojaEnvios[]): void {
  const y = doc.y;
  const alto = ALTO_ENCABEZADO_TABLA;
  doc.save().roundedRect(HOJA_MARGEN, y, HOJA_ANCHO_UTIL, alto, RADIO_CARD).fill(COLOR.canvas).restore();
  doc.save().rect(HOJA_MARGEN, y + alto - RADIO_CARD, HOJA_ANCHO_UTIL, RADIO_CARD).fill(COLOR.canvas).restore();
  let x = HOJA_MARGEN;
  for (const col of columnas) {
    rotulo(doc, col.label, x + CELDA_PADDING_X, y + 8, col.width - 2 * CELDA_PADDING_X, col.align ?? "left", 0.4);
    x += col.width;
  }
  lineaHorizontal(doc, y + alto, COLOR.border);
  doc.y = y + alto;
}

/** The card frame around one sheet's part of the table. */
function marcoTabla(doc: Doc, yInicio: number, yFin: number): void {
  doc.save().roundedRect(HOJA_MARGEN, yInicio, HOJA_ANCHO_UTIL, yFin - yInicio, RADIO_CARD).lineWidth(0.75).strokeColor(COLOR.border).stroke().restore();
}

/** Text (and optional smaller note below) of a plain cell, for measuring and drawing alike. */
interface TextoCelda {
  texto: string;
  nota?: string | null;
  negrita?: boolean;
  color?: string;
}

function textoDeCelda(fila: FilaHojaEnvios, clave: ClaveColumna): TextoCelda | null {
  switch (clave) {
    case "receta":
      return { texto: fila.receta, negrita: true, color: COLOR.primary };
    case "enviada":
      return { texto: fila.fecha, nota: fila.hora };
    case "paciente":
      return { texto: fila.paciente, nota: fila.dni, negrita: true, color: COLOR.ink };
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
  if (celda.nota) doc.font(FUENTE.texto).fontSize(TAMANO_NOTA).fillColor(COLOR.muted).text(celda.nota, x, doc.y + 2, { width: ancho, align });
}

/** `StatusBadge`-like pill: "Pagada" green / "Impaga" red, with "Cobrar al entregar" under an unpaid one. */
function dibujarPago(doc: Doc, pagada: boolean, x: number, y: number, ancho: number): void {
  const texto = pagada ? TEXTO_PAGO_PAGADA : "Impaga";
  doc.font(FUENTE.negrita).fontSize(TAMANO_NOTA + 0.5);
  const anchoBadge = doc.widthOfString(texto) + 14;
  doc.save().roundedRect(x, y - 2, anchoBadge, 14, RADIO_BADGE).fill(pagada ? COLOR.successBg : COLOR.dangerBg).restore();
  doc.fillColor(pagada ? COLOR.successText : COLOR.dangerText).text(texto, x + 7, y + 1.5, { lineBreak: false });
  if (!pagada) doc.font(FUENTE.negrita).fontSize(TAMANO_NOTA).fillColor(COLOR.dangerText).text("Cobrar al entregar", x, y + 16, { width: ancho, lineBreak: false });
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
  let yInicio = doc.y;
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
      marcoTabla(doc, yInicio, doc.y);
      doc.addPage();
      encabezadoContinuacion(doc, datos);
      yInicio = doc.y;
      encabezadoTabla(doc, columnas);
    } else if (indice > 0) {
      lineaHorizontal(doc, doc.y, COLOR.borderSoft);
    }

    const y = doc.y;
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
    doc.y = y + alto;
  });

  marcoTabla(doc, yInicio, doc.y);
}

/** Under the table: what "Impaga" means for the repartidor. */
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
    .text("Los envíos marcados Impaga se cobran al entregar. Pida firma y aclaración de quien recibe en cada envío.", HOJA_MARGEN, doc.y + 10, { width: HOJA_ANCHO_UTIL });
}

function vacio(doc: Doc): void {
  const y = doc.y;
  doc.save().roundedRect(HOJA_MARGEN, y, HOJA_ANCHO_UTIL, 70, RADIO_CARD).lineWidth(0.75).fillAndStroke(COLOR.canvas, COLOR.border).restore();
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
    lineaHorizontal(doc, PIE_Y - 6, COLOR.border);
    doc
      .font(FUENTE.texto)
      .fontSize(TAMANO_NOTA)
      .fillColor(COLOR.muted)
      .text(`${datos.farmacia.nombre}  ·  Hoja de envíos  ·  ${datos.repartidor.apellido}, ${datos.repartidor.nombre}`, HOJA_MARGEN, PIE_Y, { width: HOJA_ANCHO_UTIL * 0.7, lineBreak: false });
    doc.font(FUENTE.negrita).fillColor(COLOR.primary).text(`Hoja ${i + 1} de ${total}`, HOJA_MARGEN, PIE_Y, { width: HOJA_ANCHO_UTIL, align: "right", lineBreak: false });
    doc.page.margins.bottom = margenInferior;
  }
}

export function buildEnviosPdf(datos: DatosHojaEnvios): Promise<Buffer> {
  return renderPdf((doc) => {
    bandaMarca(doc);
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
