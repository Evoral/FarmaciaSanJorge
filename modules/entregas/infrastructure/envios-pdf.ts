/**
 * PDF "Hoja de envíos" of one repartidor (docs/specs/envios-repartidores.md, "PDF Hoja de envíos"): A4 landscape,
 * the envíos he carries that have not come back signed, with address, patient, payment state and a blank cell to sign.
 * Header: farmacia (name and phones, so the repartidor has someone to call), title, repartidor, filter and who/when
 * generated it. Footer of every sheet: "Hoja i de n" (`shared/pdf/hojas.ts`); after the table: total of envíos and how
 * many are unpaid. The Importe column exists only when the viewer holds `cotizaciones.ver` (E10).
 * Reuses `shared/pdf/pdf-document.ts#renderPdf`, same layout helpers as `modules/cierres/infrastructure/cierre-pdf.ts`.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import { HOJA_ANCHO_UTIL, HOJA_LIMITE_INFERIOR, HOJA_MARGEN, OPCIONES_HOJA_LIBRO, dibujarTabla, numerarHojas } from "@/shared/pdf/hojas";
import type { CeldaTabla, ColumnaTabla } from "@/shared/pdf/hojas";
import { formatFechaHora } from "@/shared/format/fecha";
import { formatearMonto } from "@/shared/format/monto";
import { MENSAJE_HOJA_ENVIOS_VACIA, TEXTO_PAGO_IMPAGA, textoFiltroHoja, textoPagoHoja } from "../domain/hoja-envios";
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

/** Room for the handwritten firma y aclaración of whoever receives. */
const ALTO_MINIMO_FILA = 34;

// Fit the landscape width between margins (762 pt). Recibió takes whatever is left, so it is wide enough to sign.
const COLUMNAS_BASE: ColumnaTabla[] = [
  { label: "Nº receta", width: 44 },
  { label: "Enviada", width: 60 },
  { label: "Paciente", width: 118 },
  { label: "Teléfono", width: 66 },
  { label: "Domicilio", width: 138 },
  { label: "Preparados", width: 56 },
  { label: "Pago", width: 62 },
];
const COLUMNA_IMPORTE: ColumnaTabla = { label: "Importe", width: 62, align: "right" };

/** The table's columns: Importe only with `conImporte` (E10); the last one, Recibió, fills the rest of the width. */
export function columnasHojaEnvios(conImporte: boolean): ColumnaTabla[] {
  const columnas = conImporte ? [...COLUMNAS_BASE, COLUMNA_IMPORTE] : [...COLUMNAS_BASE];
  const usado = columnas.reduce((total, c) => total + c.width, 0);
  return [...columnas, { label: "Recibió", width: HOJA_ANCHO_UTIL - usado }];
}

function celdaImporte(envio: EnvioDeRepartidor): CeldaTabla {
  if (envio.precio === null) return "Sin cotizar";
  const monto = `$ ${formatearMonto(envio.precio)}`;
  return envio.precioIncompleto ? { texto: monto, nota: "incompleto" } : monto;
}

/** One row per envío, in the same order as `columnasHojaEnvios`. */
export function filasHojaEnvios(envios: readonly EnvioDeRepartidor[], conImporte: boolean, zonaHoraria: string): CeldaTabla[][] {
  return envios.map((e) => {
    const fila: CeldaTabla[] = [
      e.numeroInterno,
      formatFechaHora(e.entregadaEn, zonaHoraria),
      { texto: `${e.pacienteApellido}, ${e.pacienteNombre}`, nota: e.pacienteDni ? `DNI ${e.pacienteDni}` : undefined },
      e.pacienteTelefono || "—",
      e.domicilio || "—",
      String(e.itemsPreparados),
      { texto: textoPagoHoja(e.pagada), negrita: !e.pagada },
    ];
    if (conImporte) fila.push(celdaImporte(e));
    fila.push("");
    return fila;
  });
}

function lineaTelefonos(fijo: string | null, celular: string | null): string | null {
  const partes = [fijo ? `Tel. ${fijo}` : null, celular ? `Cel. ${celular}` : null].filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join(" · ") : null;
}

export function buildEnviosPdf(datos: DatosHojaEnvios): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = HOJA_MARGEN;
    const mitad = HOJA_ANCHO_UTIL / 2;
    const { farmacia, repartidor } = datos;

    // Header: centered title, then the farmacia on the left and the repartidor, filter and generation on the right.
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#18181b").text("Hoja de envíos", x0, HOJA_MARGEN, { width: HOJA_ANCHO_UTIL, align: "center" });
    const yDatos = doc.y + 6;

    doc.font("Helvetica-Bold").fontSize(10).text(farmacia.nombre, x0, yDatos, { width: mitad - 10 });
    const telefonosFarmacia = lineaTelefonos(farmacia.telefonoFijo, farmacia.telefonoCelular);
    if (telefonosFarmacia) doc.font("Helvetica").fontSize(9).text(telefonosFarmacia, { width: mitad - 10 });
    const finIzquierda = doc.y;

    doc.font("Helvetica-Bold").fontSize(10).text(`Repartidor: ${repartidor.apellido}, ${repartidor.nombre}`, x0 + mitad, yDatos, { width: mitad, align: "right" });
    doc.font("Helvetica").fontSize(9).text(`Tel. ${repartidor.telefono}`, { width: mitad, align: "right" });
    doc.font("Helvetica-Bold").text(textoFiltroHoja(datos.fecha), { width: mitad, align: "right" });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#52525b")
      .text(`Generada el ${formatFechaHora(datos.generadaEn, datos.zonaHoraria)} por ${datos.generadaPor}`, { width: mitad, align: "right" });
    doc.fillColor("#18181b");
    doc.y = Math.max(finIzquierda, doc.y) + 10;

    if (datos.envios.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#52525b").text(MENSAJE_HOJA_ENVIOS_VACIA, x0).fillColor("black");
    } else {
      dibujarTabla(
        doc,
        columnasHojaEnvios(datos.conImporte),
        filasHojaEnvios(datos.envios, datos.conImporte, datos.zonaHoraria),
        () => {
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#18181b").text(`Hoja de envíos — ${repartidor.apellido}, ${repartidor.nombre} (continuación)`, x0, HOJA_MARGEN);
          doc.moveDown(0.5);
        },
        ALTO_MINIMO_FILA,
      );

      // Totals under the table; a table ending too low moves them to a new sheet.
      if (doc.y + 40 > HOJA_LIMITE_INFERIOR) doc.addPage();
      const impagas = datos.envios.filter((e) => !e.pagada).length;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#18181b");
      doc.text(`Total de envíos: ${datos.envios.length}`, x0, doc.y + 8);
      doc.text(`Impagos: ${impagas}`, x0, doc.y + 2);
      if (impagas > 0) doc.font("Helvetica").fontSize(8).fillColor("#52525b").text(`Los envíos marcados "${TEXTO_PAGO_IMPAGA}" se cobran al entregar.`, x0, doc.y + 2);
      doc.fillColor("black");
    }

    const rango = doc.bufferedPageRange();
    numerarHojas(doc, [{ primera: rango.start, ultima: rango.start + rango.count - 1, etiqueta: "Hoja de envíos" }]);
  }, OPCIONES_HOJA_LIBRO);
}
