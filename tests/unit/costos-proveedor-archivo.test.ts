/**
 * R14, R15 (docs/specs/costos-proveedor.md): the uploaded supplier list's checks, in order, and the alignment between
 * MAX_LISTA_BYTES and next.config.ts's Server Actions body limit (same discipline as tests/unit/archivo-receta-pdf.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { MAX_LISTA_BYTES, MAX_CONFIRMACION_BYTES, MENSAJES_ARCHIVO_LISTA, XLSX_MIME, validarArchivoLista } from "@/modules/costos-proveedor/domain/archivo-lista";
import { MAX_PDF_BYTES, SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES } from "@/modules/recetas/domain/archivo-receta-pdf";
import { ValidationError } from "@/shared/errors";
import nextConfig from "@/next.config";

/** A minimal zip header: what every .xlsx starts with. */
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
/** The BIFF8 / OLE2 compound file signature of a legacy .xls. */
const XLS = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);

function archivo(bytes: Uint8Array<ArrayBuffer> = ZIP, nombre = "lista.xlsx", type = XLSX_MIME): File {
  return new File([bytes], nombre, { type });
}

async function rechazo(valor: unknown): Promise<string> {
  try {
    await validarArchivoLista(valor);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as Error).message;
  }
  throw new Error("expected a ValidationError");
}

describe("validarArchivoLista", () => {
  it("accepts an .xlsx and returns its bytes", async () => {
    expect(Array.from(await validarArchivoLista(archivo()))).toEqual(Array.from(ZIP));
  });

  it("accepts it with an empty or generic MIME type when the extension says .xlsx (browsers differ)", async () => {
    await expect(validarArchivoLista(archivo(ZIP, "Lista Droguería.XLSX", ""))).resolves.toBeDefined();
    await expect(validarArchivoLista(archivo(ZIP, "lista.xlsx", "application/octet-stream"))).resolves.toBeDefined();
  });

  it("accepts the xlsx MIME type even with an odd name", async () => {
    await expect(validarArchivoLista(archivo(ZIP, "lista", XLSX_MIME))).resolves.toBeDefined();
  });

  it("rejects anything that is not a File (a string, a Blob, nothing)", async () => {
    expect(await rechazo("PK")).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
    expect(await rechazo(new Blob([ZIP]))).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
    expect(await rechazo(null)).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
    expect(await rechazo(undefined)).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
  });

  it("rejects an empty file", async () => {
    expect(await rechazo(archivo(new Uint8Array(0)))).toBe(MENSAJES_ARCHIVO_LISTA.vacio);
  });

  it("rejects a file over MAX_LISTA_BYTES WITHOUT reading it into memory", async () => {
    const grande = archivo(new Uint8Array(MAX_LISTA_BYTES + 1));
    const lectura = vi.spyOn(grande, "arrayBuffer");
    expect(await rechazo(grande)).toBe(MENSAJES_ARCHIVO_LISTA.demasiadoGrande);
    expect(lectura).not.toHaveBeenCalled();
  });

  it("accepts exactly MAX_LISTA_BYTES", async () => {
    const bytes = new Uint8Array(MAX_LISTA_BYTES);
    bytes.set(ZIP);
    await expect(validarArchivoLista(archivo(bytes))).resolves.toHaveLength(MAX_LISTA_BYTES);
  });

  it("rejects a file that is neither .xlsx nor .xls by name or type, before reading its content", async () => {
    const texto = archivo(ZIP, "lista.csv", "text/csv");
    const lectura = vi.spyOn(texto, "arrayBuffer");
    expect(await rechazo(texto)).toBe(MENSAJES_ARCHIVO_LISTA.tipoIncorrecto);
    expect(lectura).not.toHaveBeenCalled();
    expect(await rechazo(archivo(ZIP, "lista.pdf", "application/pdf"))).toBe(MENSAJES_ARCHIVO_LISTA.tipoIncorrecto);
  });

  it("gives a legacy .xls its own message (it can not be read without a new dependency)", async () => {
    const mensaje = await rechazo(archivo(XLS, "Lista de medicamentos.xls", "application/vnd.ms-excel"));
    expect(mensaje).toBe("Es un archivo .xls (Excel 97-2003). Abrilo en Excel y guardalo como .xlsx.");
    expect(mensaje).toBe(MENSAJES_ARCHIVO_LISTA.esXls);
  });

  it("recognizes a .xls by its signature even when it is renamed .xlsx", async () => {
    expect(await rechazo(archivo(XLS, "lista.xlsx"))).toBe(MENSAJES_ARCHIVO_LISTA.esXls);
  });

  it("rejects a file with the right name and type but the wrong signature (the check that counts)", async () => {
    const exe = new Uint8Array(4096);
    exe.set([0x4d, 0x5a, 0x90, 0x00]); // "MZ" DOS header
    expect(await rechazo(archivo(exe))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirmaXlsx);
    expect(await rechazo(archivo(new TextEncoder().encode("DESCRIPCION;PRECIO\nA;1\n")))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirmaXlsx);
  });

  it("rejects a file shorter than the signature", async () => {
    expect(await rechazo(archivo(new Uint8Array([0x50, 0x4b])))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirmaXlsx);
  });
});

describe("Server Actions body limit vs MAX_LISTA_BYTES", () => {
  it("is the same 1 MiB limit as the PDF imports", () => {
    expect(MAX_LISTA_BYTES).toBe(MAX_PDF_BYTES);
    expect(MAX_LISTA_BYTES).toBe(1024 * 1024);
  });

  it("next.config.ts's bodySizeLimit lets a file of exactly MAX_LISTA_BYTES through, plus the multipart framing", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES);
    expect(SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES).toBeGreaterThan(MAX_LISTA_BYTES);
  });

  it("the confirmation JSON stays inside that same body limit, with room for the framing", () => {
    expect(MAX_CONFIRMACION_BYTES).toBeLessThan(SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES);
    expect(MAX_CONFIRMACION_BYTES).toBeGreaterThan(MAX_LISTA_BYTES / 2);
  });
});
