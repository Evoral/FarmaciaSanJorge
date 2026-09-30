/**
 * P8 (docs/specs/importacion-receta-pdf.md, "Pieza 3 -- Frontera de
 * confianza"): the uploaded file's checks, in the spec's mandatory order,
 * plus the alignment between MAX_PDF_BYTES and next.config.ts's Server
 * Actions body limit. The "permiso first" half of the order is covered by
 * tests/unit/recetas-importacion-flujos.test.ts (it needs the pipeline).
 */
import { describe, it, expect, vi } from "vitest";
import {
  MAX_PDF_BYTES,
  MENSAJES_ARCHIVO_PDF,
  SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES,
  validarArchivoRecetaPdf,
} from "@/modules/recetas/domain/archivo-receta-pdf";
import { ValidationError } from "@/shared/errors";
import nextConfig from "@/next.config";

const PDF_MINIMO = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function pdf(bytes: Uint8Array<ArrayBuffer> = PDF_MINIMO, type = "application/pdf", nombre = "receta.pdf"): File {
  return new File([bytes], nombre, { type });
}

async function rechazo(archivo: unknown): Promise<string> {
  try {
    await validarArchivoRecetaPdf(archivo);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as Error).message;
  }
  throw new Error("expected a ValidationError");
}

describe("P8: validarArchivoRecetaPdf", () => {
  it("accepts a real PDF and returns its bytes", async () => {
    const bytes = await validarArchivoRecetaPdf(pdf());
    expect(Array.from(bytes)).toEqual(Array.from(PDF_MINIMO));
  });

  it("rejects anything that is not a File (a string, a Blob, nothing)", async () => {
    expect(await rechazo("%PDF-1.7")).toBe(MENSAJES_ARCHIVO_PDF.noEsArchivo);
    expect(await rechazo(new Blob([PDF_MINIMO], { type: "application/pdf" }))).toBe(MENSAJES_ARCHIVO_PDF.noEsArchivo);
    expect(await rechazo(null)).toBe(MENSAJES_ARCHIVO_PDF.noEsArchivo);
  });

  it("rejects an empty file", async () => {
    expect(await rechazo(pdf(new Uint8Array(0)))).toBe(MENSAJES_ARCHIVO_PDF.vacio);
  });

  it("rejects a file over MAX_PDF_BYTES WITHOUT reading it into memory", async () => {
    const grande = pdf(new Uint8Array(MAX_PDF_BYTES + 1));
    const lectura = vi.spyOn(grande, "arrayBuffer");
    expect(await rechazo(grande)).toBe(MENSAJES_ARCHIVO_PDF.demasiadoGrande);
    expect(lectura).not.toHaveBeenCalled();
  });

  it("accepts exactly MAX_PDF_BYTES", async () => {
    const bytes = new Uint8Array(MAX_PDF_BYTES);
    bytes.set(PDF_MINIMO);
    await expect(validarArchivoRecetaPdf(pdf(bytes))).resolves.toHaveLength(MAX_PDF_BYTES);
  });

  it("rejects a wrong MIME type before reading the content", async () => {
    const texto = pdf(PDF_MINIMO, "text/plain", "receta.txt");
    const lectura = vi.spyOn(texto, "arrayBuffer");
    expect(await rechazo(texto)).toBe(MENSAJES_ARCHIVO_PDF.tipoIncorrecto);
    expect(lectura).not.toHaveBeenCalled();
  });

  it("rejects an .exe renamed to .pdf (right type and name, no %PDF- signature)", async () => {
    const exe = new Uint8Array(4096);
    exe.set([0x4d, 0x5a, 0x90, 0x00]); // "MZ" DOS header
    expect(await rechazo(pdf(exe, "application/pdf", "receta.pdf"))).toBe(MENSAJES_ARCHIVO_PDF.sinFirmaPdf);
  });

  it("finds the signature anywhere in the first 1024 bytes, not beyond", async () => {
    const conPrefijo = new Uint8Array(2048);
    conPrefijo.set(new TextEncoder().encode("%PDF-"), 1000);
    await expect(validarArchivoRecetaPdf(pdf(conPrefijo))).resolves.toBeDefined();

    const tarde = new Uint8Array(2048);
    tarde.set(new TextEncoder().encode("%PDF-"), 1024);
    expect(await rechazo(pdf(tarde))).toBe(MENSAJES_ARCHIVO_PDF.sinFirmaPdf);
  });
});

describe("Server Actions body limit vs MAX_PDF_BYTES", () => {
  it("next.config.ts sets bodySizeLimit to MAX_PDF_BYTES plus the multipart margin", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES);
    expect(SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES).toBeGreaterThan(MAX_PDF_BYTES);
  });

  it("keeps unpdf out of the server bundle", () => {
    expect(nextConfig.serverExternalPackages).toContain("unpdf");
  });
});
