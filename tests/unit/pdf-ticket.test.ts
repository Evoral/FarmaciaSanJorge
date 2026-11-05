import { describe, it, expect } from "vitest";
import { renderTicketPdf, mm } from "@/shared/pdf/ticket";
import { buildTicketCotizacionPdf } from "@/modules/recetas/infrastructure/ticket-cotizacion-pdf";
import { buildFichaTecnicaPdf } from "@/modules/elaboracion/infrastructure/ficha-pdf";
import type { TicketCotizacion } from "@/modules/recetas/domain/ticket-cotizacion";
import type { FichaParaImprimir } from "@/modules/elaboracion/infrastructure/ficha-repository";

function parseMediaBox(pdfBuffer: Buffer): { x: number; y: number; width: number; height: number } {
  const text = pdfBuffer.toString("latin1");
  const match = text.match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/);
  if (!match) throw new Error("MediaBox not found in PDF output");
  return {
    x: parseFloat(match[1]!),
    y: parseFloat(match[2]!),
    width: parseFloat(match[3]!),
    height: parseFloat(match[4]!),
  };
}

describe("shared/pdf/ticket renderTicketPdf", () => {
  it("the output is a PDF whose MediaBox width is 80 mm (~226.77 pt) and whose height grows when dibujar returns a larger y", async () => {
    const pdfShort = await renderTicketPdf((doc) => {
      doc.text("Línea corta");
      return 60;
    });

    const pdfTall = await renderTicketPdf((doc) => {
      doc.text("Línea 1");
      doc.text("Línea 2");
      return 250;
    });

    const boxShort = parseMediaBox(pdfShort);
    const boxTall = parseMediaBox(pdfTall);

    expect(boxShort.width).toBeCloseTo(mm(80), 1);
    expect(boxShort.width).toBeCloseTo(226.77, 1);
    expect(boxTall.width).toBeCloseTo(mm(80), 1);

    expect(boxTall.height).toBeGreaterThan(boxShort.height);
  });
});

describe("buildTicketCotizacionPdf", () => {
  it("renders with and without paciente/médico, and with one ítem and with several plus a total, without throwing", async () => {
    const ticketConTodo: TicketCotizacion = {
      farmacia: "Farmacia San Jorge",
      fecha: "04/11/2026",
      paciente: "Juan Pérez",
      medico: "Dra. Gomez",
      renglones: [
        { texto: "Crema Base", precio: null },
        { texto: "Cápsulas de Magnesio", precio: null },
      ],
      total: "8500",
    };

    const ticketSinPersonasUnItem: TicketCotizacion = {
      farmacia: "Farmacia San Jorge",
      fecha: "04/11/2026",
      paciente: null,
      medico: null,
      renglones: [{ texto: "Crema 50g", precio: "4200" }],
      total: null,
    };

    const pdfConTodo = await buildTicketCotizacionPdf(ticketConTodo);
    expect(Buffer.isBuffer(pdfConTodo)).toBe(true);
    expect(pdfConTodo.subarray(0, 4).toString("utf-8")).toBe("%PDF");
    expect(parseMediaBox(pdfConTodo).width).toBeCloseTo(mm(80), 1);

    const pdfSinPersonas = await buildTicketCotizacionPdf(ticketSinPersonasUnItem);
    expect(Buffer.isBuffer(pdfSinPersonas)).toBe(true);
    expect(pdfSinPersonas.subarray(0, 4).toString("utf-8")).toBe("%PDF");
    expect(parseMediaBox(pdfSinPersonas).width).toBeCloseTo(mm(80), 1);
  });
});

describe("buildFichaTecnicaPdf", () => {
  it("still renders an 80 mm-wide PDF after the geometry moved to shared/pdf/ticket.ts", async () => {
    const ficha: FichaParaImprimir = {
      id: "ficha-1",
      version: 1,
      generadaEn: new Date(),
      generadaPorNombre: "Operador Laboratorio",
      itemDescripcion: "Crema Betametasona 0.1%",
      formaFarmaceutica: "CREMA",
      cantidadUnidades: 1,
      cantidadTotal: "100",
      unidadTotalSimbolo: "g",
      recetaNumeroInterno: "42",
      pacienteNombre: "Juan",
      pacienteApellido: "Pérez",
      medicoNombre: "Ana",
      medicoApellido: "López",
      medicoMatricula: "MN-98765",
      tenantRazonSocial: "Farmacia San Jorge S.A.",
      tenantNombreFantasia: "Farmacia San Jorge",
      tenantCuit: "30-12345678-9",
      tenantDomicilio: "Av. San Martín 123",
      tenantMatriculaFarmacia: "F-1234",
      lineas: [
        {
          drogaNombre: "Betametasona",
          cantidadTeorica: "0.1",
          excesoAplicado: "0",
          cantidadAPesar: "0.1",
          unidadSimbolo: "g",
          esEnraseManual: false,
          orden: 1,
          prescripcion: "0.1 % x 100 g",
        },
      ],
      insumos: [
        {
          nombre: "Envase pote 100g",
          cantidad: "1",
          unidadSimbolo: "u",
          detalle: null,
        },
      ],
    };

    const pdf = await buildFichaTecnicaPdf(ficha);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");

    const box = parseMediaBox(pdf);
    expect(box.width).toBeCloseTo(mm(80), 1);
    expect(box.width).toBeCloseTo(226.77, 1);
  });
});
