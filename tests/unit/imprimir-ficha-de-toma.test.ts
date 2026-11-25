import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { textoFactorLote } from "@/modules/preparaciones/application/imprimir-ficha-de-toma";
import { buildFichaTecnicaPdf, type PesadaDeLineaImprimir } from "@/modules/elaboracion/infrastructure/ficha-pdf";
import type { FichaParaImprimir } from "@/modules/elaboracion/infrastructure/ficha-repository";

function textoPdf(pdf: Buffer): string {
  const textos: string[] = [];
  for (const m of pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const stream = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
      // Decode PDFKit hex strings inside TJ/Tj arrays, ignoring kerning offsets.
      const decodificado = stream.replace(/<([0-9a-fA-F]+)>/g, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
      textos.push(decodificado);
    } catch {
      // Non-Flate stream
    }
  }
  return textos.join("\n");
}

const FICHA_BASE: FichaParaImprimir = {
  id: "ficha-1",
  version: 1,
  generadaEn: new Date("2026-11-25T10:00:00Z"),
  generadaPorNombre: "Operador Laboratorio",
  itemDescripcion: "Cápsulas Vitamina D3",
  formaFarmaceutica: "CAPSULA",
  cantidadUnidades: 30,
  cantidadTotal: null,
  unidadTotalSimbolo: null,
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
      drogaNombre: "Vitamina D3",
      cantidadTeorica: "500000",
      excesoAplicado: "0",
      cantidadAPesar: "500000",
      unidadSimbolo: "U.I.",
      esEnraseManual: false,
      orden: 1,
      prescripcion: "500.000 U.I.",
    },
    {
      drogaNombre: "Droga Manual",
      cantidadTeorica: "100",
      excesoAplicado: "0",
      cantidadAPesar: "100",
      unidadSimbolo: "mg",
      esEnraseManual: false,
      orden: 2,
      prescripcion: "100 mg",
    },
  ],
  insumos: [],
};

describe("textoFactorLote", () => {
  it("formats actividad as U.I./g, potencia < 100 as %, and returns null at 100 % or undeclared", () => {
    expect(textoFactorLote(null, "100000")).toBe("100.000 U.I./g");
    expect(textoFactorLote("100", "40000")).toBe("40.000 U.I./g");
    expect(textoFactorLote("98", null)).toBe("98 %");
    expect(textoFactorLote("98.5", undefined)).toBe("98,5 %");
    expect(textoFactorLote("100", null)).toBeNull();
    expect(textoFactorLote("100.00", undefined)).toBeNull();
    expect(textoFactorLote(null, null)).toBeNull();
    expect(textoFactorLote(undefined, undefined)).toBeNull();
  });
});

describe("buildFichaTecnicaPdf with PesadaImprimir", () => {
  it("renders lot rows and 'Cantidad manual' when pesada is provided, and renders as before without one", async () => {
    const pdfSinPesada = await buildFichaTecnicaPdf(FICHA_BASE);
    const textoSinPesada = textoPdf(pdfSinPesada);
    expect(textoSinPesada).not.toContain("Lote A-1");
    expect(textoSinPesada).not.toContain("Cantidad manual");

    const pesada = new Map<number, PesadaDeLineaImprimir>([
      [
        1,
        {
          tipo: "LOTES",
          lotes: [
            { lote: "A-1", cantidad: "3", unidadSimbolo: "g", factor: "100.000 U.I./g" },
            { lote: "B-2", cantidad: "5", unidadSimbolo: "g", factor: "40.000 U.I./g" },
          ],
        },
      ],
      [2, { tipo: "MANUAL", cantidad: null, unidadSimbolo: "g" }],
    ]);

    const pdfConPesada = await buildFichaTecnicaPdf(FICHA_BASE, pesada);
    const textoConPesada = textoPdf(pdfConPesada).replace(/\]\s*TJ|\[\s*|<\s*|>\s*|\s+\d+\s+/g, (m) => (m.includes("TJ") ? "\n" : ""));

    expect(textoConPesada).toContain("Lote A-1 (100.000 U.I./g)");
    expect(textoConPesada).toContain("Lote B-2 (40.000 U.I./g)");
    expect(textoConPesada).toContain("(500.000 U.I.)");
    expect(textoConPesada).toContain("Cantidad manual");
    expect(textoConPesada).toContain("______ g");
  });
});
