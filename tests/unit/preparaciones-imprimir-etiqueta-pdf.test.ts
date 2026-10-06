/**
 * `imprimirEtiquetaPdf` with a size (etiqueta tamaños): the size chosen in
 * the print dialog decides the PDF's page; no size keeps the 100 x 42 mm of
 * old links; a size that does not resolve (unknown, another tenant's,
 * deactivated -> NOT_FOUND from `getTamanoParaImprimir`) aborts BEFORE the
 * etiqueta is marked as printed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "@/shared/errors";
import type { DatosEtiqueta } from "@/modules/preparaciones/domain/etiqueta";

const TAMANO_ID = "22222222-2222-4222-8222-222222222222";
const PREPARACION_ID = "33333333-3333-4333-8333-333333333333";

const DATOS: DatosEtiqueta & { etiquetaId: string; generadaEn: Date } = {
  etiquetaId: "44444444-4444-4444-8444-444444444444",
  generadaEn: new Date(),
  formaFarmaceutica: "CAPSULA",
  cantidadUnidades: 30,
  componentes: [{ drogaNombre: "Mazindol", cantidad: "2", unidadSimbolo: "mg", modoExpresion: "POR_DOSIS", esPrincipioActivo: true }],
  asientoNumeroCorrelativo: "1520",
  recetaNumeroInterno: "88",
  pacienteTexto: "Pérez, Juan",
  medicoNombre: "Ana",
  medicoApellido: "Gómez",
  medicoMatricula: "4521",
  medicoJurisdiccion: "PROVINCIAL",
  directorTecnico: null,
  tenantDomicilio: null,
};

const getEtiquetaParaImprimirMock = vi.fn<(preparacionId: string) => Promise<typeof DATOS>>(async () => DATOS);
const marcarEtiquetaImpresaMock = vi.fn<(etiquetaId: string) => Promise<undefined>>(async () => undefined);
const getTamanoParaImprimirMock = vi.fn<(tamanoId: string) => Promise<{ id: string; nombre: string; anchoMm: number; altoMm: number }>>();

vi.mock("@/modules/preparaciones/application/get-etiqueta-para-imprimir", () => ({ getEtiquetaParaImprimir: (arg: string) => getEtiquetaParaImprimirMock(arg) }));
vi.mock("@/modules/preparaciones/application/marcar-etiqueta-impresa", () => ({ marcarEtiquetaImpresa: (arg: string) => marcarEtiquetaImpresaMock(arg) }));
vi.mock("@/modules/etiqueta-tamanos/application/get-tamano-para-imprimir", () => ({ getTamanoParaImprimir: (arg: string) => getTamanoParaImprimirMock(arg) }));

const { imprimirEtiquetaPdf } = await import("@/modules/preparaciones/application/imprimir-etiqueta-pdf");

function mediaBox(pdf: Buffer): { ancho: number; alto: number } {
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no MediaBox found in the PDF");
  return { ancho: Number(match[1]), alto: Number(match[2]) };
}

beforeEach(() => {
  getEtiquetaParaImprimirMock.mockClear();
  marcarEtiquetaImpresaMock.mockClear();
  getTamanoParaImprimirMock.mockReset();
});

describe("imprimirEtiquetaPdf", () => {
  it("renders on the chosen size", async () => {
    getTamanoParaImprimirMock.mockResolvedValue({ id: TAMANO_ID, nombre: "Frasco chico", anchoMm: 50, altoMm: 30 });

    const { pdf, preparacionId } = await imprimirEtiquetaPdf(PREPARACION_ID, TAMANO_ID);

    expect(preparacionId).toBe(PREPARACION_ID);
    expect(getTamanoParaImprimirMock).toHaveBeenCalledWith(TAMANO_ID);
    expect(marcarEtiquetaImpresaMock).toHaveBeenCalledWith(DATOS.etiquetaId);
    const box = mediaBox(pdf);
    expect(box.ancho).toBeCloseTo(141.7, 1);
    expect(box.alto).toBeCloseTo(85, 1);
  });

  it("without a size keeps the 100 x 42 mm of old links and never looks a size up", async () => {
    const { pdf } = await imprimirEtiquetaPdf(PREPARACION_ID);

    expect(getTamanoParaImprimirMock).not.toHaveBeenCalled();
    const box = mediaBox(pdf);
    expect(box.ancho).toBeCloseTo(283.46, 1);
    expect(box.alto).toBeCloseTo(119.06, 1);
  });

  it("a size that does not resolve (unknown / other tenant / deactivated) fails with NOT_FOUND and does NOT mark the etiqueta as printed", async () => {
    getTamanoParaImprimirMock.mockRejectedValue(new NotFoundError("El tamaño de etiqueta no existe o está dado de baja."));

    await expect(imprimirEtiquetaPdf(PREPARACION_ID, TAMANO_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(marcarEtiquetaImpresaMock).not.toHaveBeenCalled();
  });
});
