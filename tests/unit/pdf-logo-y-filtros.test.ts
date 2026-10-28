import { describe, expect, it } from "vitest";
import { logoParaPdf } from "@/shared/pdf/logo";
import { textoDeFiltro } from "@/shared/format/texto-filtro";

function png(ancho: number, alto: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, ancho);
  v.setUint32(20, alto);
  return b;
}

function jpeg(ancho: number, alto: number): Uint8Array {
  // SOI, an APP0 segment of length 4, then SOF0 with height/width.
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 0xff, ancho >> 8, ancho & 0xff, 0x03]);
}

describe("logoParaPdf: the tenant's own logo for printed documents", () => {
  it("reads the proportion of a PNG and a JPEG", () => {
    expect(logoParaPdf({ bytes: png(283, 95), tipo: "image/png" })?.proporcion).toBeCloseTo(283 / 95);
    expect(logoParaPdf({ bytes: jpeg(400, 200), tipo: "image/jpeg" })?.proporcion).toBe(2);
  });

  it("no logo, a WebP (PDFKit cannot draw it) or an unreadable header -> null", () => {
    expect(logoParaPdf(null)).toBeNull();
    expect(logoParaPdf({ bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), tipo: "image/webp" })).toBeNull();
    expect(logoParaPdf({ bytes: new Uint8Array([0x89, 0x50]), tipo: "image/png" })).toBeNull();
  });
});

describe("textoDeFiltro (audit P4-02)", () => {
  it("turns control characters into spaces and caps the length", () => {
    expect(textoDeFiltro("a\r\nb\tc")).toBe("a b c");
    expect(textoDeFiltro("x".repeat(100))).toBe(`${"x".repeat(60)}…`);
    expect(textoDeFiltro(null)).toBe("");
  });
});
