/**
 * `imprimirEtiquetaPdf` on the sheet (docs/specs/hoja-etiquetas.md R6, R7): the PDF page is
 * the sheet and the etiqueta lands in the chosen cell. Everything that decides the page
 * and the spot -- the sheet, the size (explicit or the first that fits), the cell -- is
 * resolved BEFORE the etiqueta is marked as printed: a size that does not resolve, does
 * not fit, or a cell that is not an integer or is outside the grid aborts without marking.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/shared/errors";
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
  tenantTelefonoFijo: null,
  tenantTelefonoCelular: null,
  posologia: null,
  fraccionDosisPorUnidad: "1",
  fechaVencimiento: null,
  tipoVencimiento: null,
};

const A4 = { anchoMm: 210, altoMm: 297, margenMm: 5 };
const ESTANDAR = { id: TAMANO_ID, nombre: "Estándar 100 × 42 mm", anchoMm: 100, altoMm: 42 };

type Tamano = { id: string; nombre: string; anchoMm: number; altoMm: number };

const getEtiquetaParaImprimirMock = vi.fn<(preparacionId: string) => Promise<typeof DATOS>>(async () => DATOS);
const marcarEtiquetaImpresaMock = vi.fn<(etiquetaId: string) => Promise<undefined>>(async () => undefined);
const getTamanoParaImprimirMock = vi.fn<(tamanoId: string) => Promise<Tamano>>();
const listTamanosParaImprimirMock = vi.fn<() => Promise<Tamano[]>>();
const getHojaParaImprimirMock = vi.fn<() => Promise<typeof A4>>();

vi.mock("@/modules/preparaciones/application/get-etiqueta-para-imprimir", () => ({ getEtiquetaParaImprimir: (arg: string) => getEtiquetaParaImprimirMock(arg) }));
vi.mock("@/modules/preparaciones/application/marcar-etiqueta-impresa", () => ({ marcarEtiquetaImpresa: (arg: string) => marcarEtiquetaImpresaMock(arg) }));
vi.mock("@/modules/etiqueta-tamanos/application/get-tamano-para-imprimir", () => ({ getTamanoParaImprimir: (arg: string) => getTamanoParaImprimirMock(arg) }));
vi.mock("@/modules/etiqueta-tamanos/application/list-tamanos-para-imprimir", () => ({ listTamanosParaImprimir: () => listTamanosParaImprimirMock() }));
vi.mock("@/modules/etiqueta-tamanos/application/get-hoja-para-imprimir", () => ({ getHojaParaImprimir: () => getHojaParaImprimirMock() }));

const { imprimirEtiquetaPdf, CELDA_NO_VALIDA_MESSAGE, TAMANO_NO_ENTRA_MESSAGE } = await import("@/modules/preparaciones/application/imprimir-etiqueta-pdf");

const PT_POR_MM = 72 / 25.4;

function mediaBox(pdf: Buffer): { ancho: number; alto: number } {
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no MediaBox found in the PDF");
  return { ancho: Number(match[1]), alto: Number(match[2]) };
}

beforeEach(() => {
  getEtiquetaParaImprimirMock.mockClear();
  marcarEtiquetaImpresaMock.mockClear();
  getTamanoParaImprimirMock.mockReset();
  listTamanosParaImprimirMock.mockReset();
  getHojaParaImprimirMock.mockReset();
  getHojaParaImprimirMock.mockResolvedValue(A4);
  getTamanoParaImprimirMock.mockResolvedValue(ESTANDAR);
  listTamanosParaImprimirMock.mockResolvedValue([ESTANDAR]);
});

describe("imprimirEtiquetaPdf -- the sheet and the chosen size", () => {
  it("renders the sheet as the page, with the etiqueta of the chosen size, and marks it impresa", async () => {
    getTamanoParaImprimirMock.mockResolvedValue({ id: TAMANO_ID, nombre: "Frasco chico", anchoMm: 50, altoMm: 30 });

    const { pdf, preparacionId } = await imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID });

    expect(preparacionId).toBe(PREPARACION_ID);
    expect(getTamanoParaImprimirMock).toHaveBeenCalledWith(TAMANO_ID);
    expect(marcarEtiquetaImpresaMock).toHaveBeenCalledWith(DATOS.etiquetaId);
    const box = mediaBox(pdf);
    expect(box.ancho).toBeCloseTo(210 * PT_POR_MM, 1);
    expect(box.alto).toBeCloseTo(297 * PT_POR_MM, 1);
  });

  it("without a size (old links) takes the first active size that fits, and never looks one up by id", async () => {
    const { pdf } = await imprimirEtiquetaPdf(PREPARACION_ID);

    expect(getTamanoParaImprimirMock).not.toHaveBeenCalled();
    expect(listTamanosParaImprimirMock).toHaveBeenCalledTimes(1);
    expect(marcarEtiquetaImpresaMock).toHaveBeenCalledTimes(1);
    expect(mediaBox(pdf).ancho).toBeCloseTo(210 * PT_POR_MM, 1);
  });

  it("without a size and with none that fits it is NOT_FOUND and does NOT mark the etiqueta as printed", async () => {
    listTamanosParaImprimirMock.mockResolvedValue([]);

    await expect(imprimirEtiquetaPdf(PREPARACION_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(marcarEtiquetaImpresaMock).not.toHaveBeenCalled();
  });

  it("a size that does not resolve (unknown / other tenant / deactivated) fails with NOT_FOUND and does NOT mark the etiqueta as printed", async () => {
    getTamanoParaImprimirMock.mockRejectedValue(new NotFoundError("El tamaño de etiqueta no existe o está dado de baja."));

    await expect(imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID })).rejects.toBeInstanceOf(NotFoundError);
    expect(marcarEtiquetaImpresaMock).not.toHaveBeenCalled();
  });

  it("an active size that does not fit the sheet is a VALIDATION_ERROR and does NOT mark the etiqueta as printed", async () => {
    getTamanoParaImprimirMock.mockResolvedValue({ id: TAMANO_ID, nombre: "Rollo ancho", anchoMm: 250, altoMm: 30 });

    const error = await imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(TAMANO_NO_ENTRA_MESSAGE);
    expect(marcarEtiquetaImpresaMock).not.toHaveBeenCalled();
  });
});

describe("imprimirEtiquetaPdf -- the cell (R7)", () => {
  it("a missing columna and / or fila is 1", async () => {
    await expect(imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID })).resolves.toBeDefined();
    await expect(imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID, columna: "2" })).resolves.toBeDefined();
    await expect(imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID, fila: "6" })).resolves.toBeDefined();
  });

  it("accepts the last cell of the grid (2 x 6 for 100 x 42 on A4 / 5 mm)", async () => {
    await expect(imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID, columna: "2", fila: "6" })).resolves.toBeDefined();
    expect(marcarEtiquetaImpresaMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["column past the grid", { columna: "3", fila: "1" }],
    ["row past the grid", { columna: "1", fila: "7" }],
    ["column zero", { columna: "0", fila: "1" }],
    ["negative row", { columna: "1", fila: "-1" }],
    ["decimal column", { columna: "1.5", fila: "1" }],
    ["text", { columna: "dos", fila: "1" }],
    ["exponent", { columna: "1e0", fila: "1" }],
    ["huge number", { columna: "99999999999", fila: "1" }],
  ])("an out-of-grid or malformed cell (%s) is a VALIDATION_ERROR and does NOT mark the etiqueta as printed", async (_nombre, celda) => {
    const error = await imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID, ...celda }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(CELDA_NO_VALIDA_MESSAGE);
    expect(marcarEtiquetaImpresaMock).not.toHaveBeenCalled();
    expect(getEtiquetaParaImprimirMock).not.toHaveBeenCalled();
  });

  it("the grid depends on the size: 3 columns exist for a 60 mm size but not for 100 mm", async () => {
    getTamanoParaImprimirMock.mockResolvedValue({ id: TAMANO_ID, nombre: "Chico", anchoMm: 60, altoMm: 30 });
    await expect(imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID, columna: "3" })).resolves.toBeDefined();
    getTamanoParaImprimirMock.mockResolvedValue(ESTANDAR);
    await expect(imprimirEtiquetaPdf(PREPARACION_ID, { tamanoId: TAMANO_ID, columna: "3" })).rejects.toBeInstanceOf(ValidationError);
  });
});
