/**
 * Unit tests for modules/recetas/domain/receta-qr.ts (docs: importacion-receta-qr
 * spec, R1 -- cases P11-P17). The hash is the ONLY thing taken from what the
 * user scans or types; everything here is fictitious.
 */
import { describe, it, expect } from "vitest";
import { MENSAJES_LECTURA_QR, extraerHashRcta } from "@/modules/recetas/domain/receta-qr";

// RCTA's decrypter is CASE-SENSITIVE on the hash: the canonical form is the UPPERCASE hex printed in the QR URL.
const HASH = "0123456789ABCDEF".repeat(4);
const OTRO_HASH = "FEDCBA9876543210".repeat(4);

describe("P11-P13: a valid hash is returned in its canonical UPPERCASE form", () => {
  it("P11: from the emisor's verification URL", () => {
    expect(extraerHashRcta(`https://verumrp.com.ar/prescripcion/${HASH}`)).toBe(HASH);
    expect(extraerHashRcta(`https://www.verumrp.com.ar/prescripcion/${HASH}`)).toBe(HASH);
  });

  it("P12: bare, with surrounding spaces and a trailing newline (keyboard-wedge scanner)", () => {
    expect(extraerHashRcta(`  ${HASH}\n`)).toBe(HASH);
    expect(extraerHashRcta(HASH)).toBe(HASH);
  });

  it("P13: regression (RCTA hash is case-sensitive): the uppercase hash of a real link is returned UNCHANGED, never lowercased", () => {
    expect(extraerHashRcta(`https://verumrp.com.ar/prescripcion/${HASH}`)).toBe(HASH);
    expect(extraerHashRcta(`https://verumrp.com.ar/prescripcion/${HASH}`)).not.toBe(HASH.toLowerCase());
    expect(extraerHashRcta(`HTTPS://VERUMRP.COM.AR/prescripcion/${HASH}`)).toBe(HASH);
  });

  it("P13: lowercase input (Caps Lock flipped on the scanner) and mixed case come back uppercase", () => {
    expect(extraerHashRcta(HASH.toLowerCase())).toBe(HASH);
    expect(extraerHashRcta(`https://verumrp.com.ar/prescripcion/${HASH.toLowerCase()}`)).toBe(HASH);
    const mezclado = [...HASH].map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase())).join("");
    expect(mezclado).not.toBe(HASH);
    expect(extraerHashRcta(mezclado)).toBe(HASH);
  });

  it("P13: two runs that differ only in case are the SAME hash, not two different ones", () => {
    expect(extraerHashRcta(`${HASH} ${HASH.toLowerCase()}`)).toBe(HASH);
    expect(extraerHashRcta(`https://verumrp.com.ar/prescripcion/${HASH.toLowerCase()}?x=${HASH}`)).toBe(HASH);
  });

  it("the same hash twice is still that hash", () => {
    expect(extraerHashRcta(`${HASH} ${HASH}`)).toBe(HASH);
  });
});

describe("P14: scanner-garbled punctuation", () => {
  it("a keyboard-layout mangled URL that does not parse still yields the hash", () => {
    expect(extraerHashRcta(`https;--verumrp.com.ar-prescripcion-${HASH}`)).toBe(HASH);
    expect(extraerHashRcta(`https;--verumrp.com.ar-prescripcion-${HASH.toLowerCase()}`)).toBe(HASH);
  });
});

describe("P15-P16: invalid input", () => {
  it("P15: a 63-char or a 65-char hex run is not a hash", () => {
    expect(extraerHashRcta(HASH.slice(0, 63))).toBeNull();
    expect(extraerHashRcta(`${HASH}a`)).toBeNull();
    expect(extraerHashRcta(`https://verumrp.com.ar/prescripcion/${HASH}0`)).toBeNull();
    expect(extraerHashRcta(`0${HASH}`)).toBeNull();
  });

  it("P16: empty, whitespace-only and garbage are not a hash", () => {
    expect(extraerHashRcta("")).toBeNull();
    expect(extraerHashRcta("   \n")).toBeNull();
    expect(extraerHashRcta("hola, esto no es un QR")).toBeNull();
    expect(extraerHashRcta("https://verumrp.com.ar/prescripcion/")).toBeNull();
  });

  it("P16: two DIFFERENT 64-hex runs are ambiguous", () => {
    expect(extraerHashRcta(`${HASH} ${OTRO_HASH}`)).toBeNull();
    expect(extraerHashRcta(`https://verumrp.com.ar/prescripcion/${HASH}?x=${OTRO_HASH}`)).toBeNull();
  });
});

describe("P17: foreign hosts are rejected before any network call", () => {
  it("a parseable URL on another host is invalid even if it carries a valid hash", () => {
    expect(extraerHashRcta(`https://evil.example/prescripcion/${HASH}`)).toBeNull();
    expect(extraerHashRcta(`http://verumrp.com.ar.evil.example/prescripcion/${HASH}`)).toBeNull();
    expect(extraerHashRcta(`https://notverumrp.com.ar/prescripcion/${HASH}`)).toBeNull();
  });

  it("userinfo tricks: the real host is what follows the @", () => {
    expect(extraerHashRcta(`https://verumrp.com.ar@evil.com/prescripcion/${HASH}`)).toBeNull();
    expect(extraerHashRcta(`https://evil.com@verumrp.com.ar/prescripcion/${HASH}`)).toBe(HASH);
  });

  it("look-alike hosts are rejected regardless of case", () => {
    expect(extraerHashRcta(`HTTPS://VERUMRP.COM.AR.EVIL.COM/prescripcion/${HASH}`)).toBeNull();
    expect(extraerHashRcta(`https://evilverumrp.com.ar/prescripcion/${HASH}`)).toBeNull();
  });

  it("a trailing-dot (absolute) emisor host is still the emisor", () => {
    expect(extraerHashRcta(`https://verumrp.com.ar./prescripcion/${HASH}`)).toBe(HASH);
  });

  it("only text that starts with a real scheme and a double slash is host-checked", () => {
    // A scanner that turns the slashes into dashes leaves "https:" parseable as a URL whose
    // "host" is the whole garbled remainder; that must not read as a foreign host.
    expect(extraerHashRcta(`https:--verumrp.com.ar-prescripcion-${HASH}`)).toBe(HASH);
    expect(extraerHashRcta(`HTTPS:--VERUMRP.COM.AR-PRESCRIPCION-${HASH.toLowerCase()}`)).toBe(HASH);
  });

  it("deliberate narrowing of P17: a foreign host WITHOUT scheme:// is not host-checked", () => {
    // Harmless: only the hash is ever used, and always against the constant endpoint.
    expect(extraerHashRcta(`https:evil.com/prescripcion/${HASH}`)).toBe(HASH);
    expect(extraerHashRcta(`https:/evil.com/${HASH}`)).toBe(HASH);
    // With the full scheme:// the same foreign host IS rejected.
    expect(extraerHashRcta(`https://evil.com/${HASH}`)).toBeNull();
  });

  it("a hash next to non-hex letters is still the only 64-hex run", () => {
    expect(extraerHashRcta(`prescripcion-${HASH}-g`)).toBe(HASH);
    expect(extraerHashRcta(`xyz${HASH}xyz`)).toBe(HASH);
  });

  it("the rejection message is the generic one", () => {
    expect(MENSAJES_LECTURA_QR.QR_INVALIDO).toBe("QR no válido o receta no encontrada");
  });
});

describe("user-facing messages", () => {
  it("each failure code has a distinct Spanish message", () => {
    expect(MENSAJES_LECTURA_QR.RCTA_NO_DISPONIBLE).toBe("No se pudo consultar RCTA, importá el PDF");
    expect(MENSAJES_LECTURA_QR.FORMATO_INESPERADO).toMatch(/formato/i);
    expect(new Set(Object.values(MENSAJES_LECTURA_QR)).size).toBe(3);
  });
});
