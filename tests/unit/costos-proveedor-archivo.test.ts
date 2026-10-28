/**
 * R14, R15 (openspec/specs/costos-proveedor/spec.md): the uploaded supplier list's checks, in order (format detected from the
 * signature, .xls and .xlsx both accepted), its own 4 MiB limit, and the alignment between that limit and
 * next.config.ts's Server Actions body limit (same discipline as tests/unit/archivo-receta-pdf.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import {
  LISTA_BODY_SIZE_LIMIT_BYTES,
  MAX_CONFIRMACION_BYTES,
  MAX_LISTA_BYTES,
  MENSAJES_ARCHIVO_LISTA,
  XLSX_MIME,
  XLS_MIME,
  validarArchivoLista,
} from "@/modules/costos-proveedor/domain/archivo-lista";
import { MAX_PDF_BYTES } from "@/modules/recetas/domain/archivo-receta-pdf";
import { ValidationError } from "@/shared/errors";
import nextConfig from "@/next.config";

/** A minimal zip header: what every .xlsx starts with. */
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
/** The OLE2 / compound file signature of a .xls (BIFF8). */
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

describe("validarArchivoLista -- .xlsx", () => {
  it("accepts an .xlsx and returns its bytes and its format", async () => {
    const { bytes, formato } = await validarArchivoLista(archivo());
    expect(Array.from(bytes)).toEqual(Array.from(ZIP));
    expect(formato).toBe("XLSX");
  });

  it("accepts it with an empty or generic MIME type when the extension says .xlsx (browsers differ)", async () => {
    await expect(validarArchivoLista(archivo(ZIP, "Lista Droguería.XLSX", ""))).resolves.toMatchObject({ formato: "XLSX" });
    await expect(validarArchivoLista(archivo(ZIP, "lista.xlsx", "application/octet-stream"))).resolves.toMatchObject({ formato: "XLSX" });
  });

  it("accepts the xlsx MIME type even with an odd name", async () => {
    await expect(validarArchivoLista(archivo(ZIP, "lista", XLSX_MIME))).resolves.toMatchObject({ formato: "XLSX" });
  });
});

describe("validarArchivoLista -- .xls (BIFF8)", () => {
  it("accepts a .xls by its OLE signature and reports the XLS format", async () => {
    const { bytes, formato } = await validarArchivoLista(archivo(XLS, "Lista de medicamentos.xls", XLS_MIME));
    expect(Array.from(bytes)).toEqual(Array.from(XLS));
    expect(formato).toBe("XLS");
  });

  it("accepts it with an empty or generic MIME type when the extension says .xls", async () => {
    await expect(validarArchivoLista(archivo(XLS, "lista.XLS", ""))).resolves.toMatchObject({ formato: "XLS" });
    await expect(validarArchivoLista(archivo(XLS, "lista.xls", "application/octet-stream"))).resolves.toMatchObject({ formato: "XLS" });
  });

  it("accepts the xls MIME type even with an odd name", async () => {
    await expect(validarArchivoLista(archivo(XLS, "lista", XLS_MIME))).resolves.toMatchObject({ formato: "XLS" });
  });
});

describe("validarArchivoLista -- the signature decides the format, not the name or the MIME type", () => {
  it("reads an OLE2 file named .xlsx as XLS", async () => {
    await expect(validarArchivoLista(archivo(XLS, "lista.xlsx"))).resolves.toMatchObject({ formato: "XLS" });
  });

  it("reads a zip named .xls as XLSX", async () => {
    await expect(validarArchivoLista(archivo(ZIP, "lista.xls", XLS_MIME))).resolves.toMatchObject({ formato: "XLSX" });
  });

  it("rejects a file with the right name and type but the wrong signature (the check that counts)", async () => {
    const exe = new Uint8Array(4096);
    exe.set([0x4d, 0x5a, 0x90, 0x00]); // "MZ" DOS header
    expect(await rechazo(archivo(exe))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirma);
    expect(await rechazo(archivo(exe, "lista.xls", XLS_MIME))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirma);
    expect(await rechazo(archivo(new TextEncoder().encode("DESCRIPCION;PRECIO\nA;1\n")))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirma);
  });

  it("rejects a file shorter than a signature, for both formats", async () => {
    expect(await rechazo(archivo(new Uint8Array([0x50, 0x4b])))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirma);
    expect(await rechazo(archivo(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "lista.xls", XLS_MIME))).toBe(MENSAJES_ARCHIVO_LISTA.sinFirma);
  });

  it("no longer tells the user to convert a .xls (it is read natively)", () => {
    for (const mensaje of Object.values(MENSAJES_ARCHIVO_LISTA)) expect(mensaje).not.toMatch(/guardalo como \.xlsx/);
    expect(MENSAJES_ARCHIVO_LISTA.noEsArchivo).toContain(".xls");
    expect(MENSAJES_ARCHIVO_LISTA.tipoIncorrecto).toContain(".xls");
  });
});

describe("validarArchivoLista -- the checks before the content", () => {
  it("rejects anything that is not a File (a string, a Blob, nothing)", async () => {
    expect(await rechazo("PK")).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
    expect(await rechazo(new Blob([ZIP]))).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
    expect(await rechazo(null)).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
    expect(await rechazo(undefined)).toBe(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
  });

  it("rejects an empty file", async () => {
    expect(await rechazo(archivo(new Uint8Array(0)))).toBe(MENSAJES_ARCHIVO_LISTA.vacio);
  });

  it("rejects a file over MAX_LISTA_BYTES WITHOUT reading it into memory, for both formats", async () => {
    for (const nombre of ["lista.xlsx", "lista.xls"]) {
      const grande = archivo(new Uint8Array(MAX_LISTA_BYTES + 1), nombre);
      const lectura = vi.spyOn(grande, "arrayBuffer");
      expect(await rechazo(grande)).toBe(MENSAJES_ARCHIVO_LISTA.demasiadoGrande);
      expect(lectura).not.toHaveBeenCalled();
    }
  });

  it("accepts exactly MAX_LISTA_BYTES", async () => {
    const xlsx = new Uint8Array(MAX_LISTA_BYTES);
    xlsx.set(ZIP);
    await expect(validarArchivoLista(archivo(xlsx))).resolves.toMatchObject({ formato: "XLSX" });
    const xls = new Uint8Array(MAX_LISTA_BYTES);
    xls.set(XLS);
    const resultado = await validarArchivoLista(archivo(xls, "lista.xls", XLS_MIME));
    expect(resultado.bytes).toHaveLength(MAX_LISTA_BYTES);
    expect(resultado.formato).toBe("XLS");
  });

  it("rejects a file that is neither .xlsx nor .xls by name or type, before reading its content", async () => {
    const texto = archivo(ZIP, "lista.csv", "text/csv");
    const lectura = vi.spyOn(texto, "arrayBuffer");
    expect(await rechazo(texto)).toBe(MENSAJES_ARCHIVO_LISTA.tipoIncorrecto);
    expect(lectura).not.toHaveBeenCalled();
    expect(await rechazo(archivo(ZIP, "lista.pdf", "application/pdf"))).toBe(MENSAJES_ARCHIVO_LISTA.tipoIncorrecto);
  });
});

describe("price list size limit vs the Server Actions body limit", () => {
  it("is 4 MiB: its own limit (under the ~4.5 MB Vercel request cap), no longer tied to the 1 MiB of the PDF imports", () => {
    expect(MAX_LISTA_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_LISTA_BYTES).toBeGreaterThan(MAX_PDF_BYTES);
    expect(MENSAJES_ARCHIVO_LISTA.demasiadoGrande).toContain("4 MB");
  });

  it("the real supplier file (2.1 MB .xls) fits, with room", () => {
    expect(2.1 * 1024 * 1024).toBeLessThan(MAX_LISTA_BYTES);
  });

  it("next.config.ts's bodySizeLimit lets a file of exactly MAX_LISTA_BYTES through, plus the multipart framing", () => {
    expect(LISTA_BODY_SIZE_LIMIT_BYTES).toBeGreaterThan(MAX_LISTA_BYTES);
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBeGreaterThanOrEqual(LISTA_BODY_SIZE_LIMIT_BYTES);
  });

  it("the confirmation JSON stays inside that same body limit, with room for the framing", () => {
    expect(MAX_CONFIRMACION_BYTES).toBeLessThan(LISTA_BODY_SIZE_LIMIT_BYTES);
    expect(MAX_CONFIRMACION_BYTES).toBeGreaterThan(MAX_LISTA_BYTES / 2);
  });
});
