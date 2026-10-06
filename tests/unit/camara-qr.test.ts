/**
 * Unit tests for modules/recetas/ui/camara-qr.ts (docs/specs/importacion-receta-qr.md,
 * camera section; spec cases P58-P62). The scanner component cannot be rendered
 * here (vitest runs in node, without a DOM or a camera), so every decision it
 * takes is a pure function over plain values; the wiring is verified by hand.
 */
import { describe, it, expect, vi } from "vitest";
import {
  MAX_FALLOS_DETECTOR,
  RESTRICCIONES_CAMARA,
  VENTANA_DEDUPE_MS,
  VIGENCIA_PISTA_MS,
  accionTrasFallos,
  accionTrasObtenerCamara,
  claseErrorCamara,
  dimensionesFrame,
  enviarFormulario,
  esQrNoReceta,
  estadoPermiteReintentar,
  evaluarLecturaQr,
  mensajeEstadoCamara,
  motorLectura,
  pistaVigente,
  soporteCamara,
  type EntornoCamara,
  type EstadoMensajeCamara,
} from "@/modules/recetas/ui/camara-qr";

const HASH = "0123456789ABCDEF".repeat(4);
const URL_RECETA = `https://verumrp.com.ar/prescripcion/${HASH}`;

const ENTORNO_OK: EntornoCamara = {
  isSecureContext: true,
  tieneGetUserMedia: true,
  politicaPermiteCamara: true,
  detectorSoportaQr: true,
};

describe("soporteCamara: is the camera usable at all in this document", () => {
  it("is ok on a secure context with getUserMedia and an allowing policy", () => {
    expect(soporteCamara(ENTORNO_OK)).toBe("ok");
  });

  it("P61: an insecure context is reported first, even when the API is missing too", () => {
    expect(soporteCamara({ ...ENTORNO_OK, isSecureContext: false })).toBe("inseguro");
    expect(soporteCamara({ ...ENTORNO_OK, isSecureContext: false, tieneGetUserMedia: false })).toBe("inseguro");
  });

  it("P61: a secure context without getUserMedia has no camera API", () => {
    expect(soporteCamara({ ...ENTORNO_OK, tieneGetUserMedia: false })).toBe("sin-api");
  });

  it("P63: a document whose Permissions-Policy forbids the camera is blocked by policy", () => {
    expect(soporteCamara({ ...ENTORNO_OK, politicaPermiteCamara: false })).toBe("bloqueada-politica");
  });

  it("a browser that does not expose the policy (undefined) is given the benefit of the doubt", () => {
    expect(soporteCamara({ ...ENTORNO_OK, politicaPermiteCamara: undefined })).toBe("ok");
  });
});

describe("motorLectura: which decoder reads the frames (P58/P59)", () => {
  it("P58: BarcodeDetector when it supports qr_code", () => {
    expect(motorLectura({ ...ENTORNO_OK, detectorSoportaQr: true })).toBe("barcode-detector");
  });

  it("P59: jsQR when BarcodeDetector is absent or does not list qr_code", () => {
    expect(motorLectura({ ...ENTORNO_OK, detectorSoportaQr: false })).toBe("jsqr");
  });

  it("sin-camara whenever the camera is not usable, whatever the decoder", () => {
    expect(motorLectura({ ...ENTORNO_OK, isSecureContext: false })).toBe("sin-camara");
    expect(motorLectura({ ...ENTORNO_OK, tieneGetUserMedia: false, detectorSoportaQr: false })).toBe("sin-camara");
    expect(motorLectura({ ...ENTORNO_OK, politicaPermiteCamara: false })).toBe("sin-camara");
  });
});

describe("claseErrorCamara: getUserMedia errors", () => {
  const error = (name: string) => ({ name });

  it("P60: NotAllowedError and SecurityError are a denied permission", () => {
    expect(claseErrorCamara(error("NotAllowedError"), true)).toBe("permiso-denegado");
    expect(claseErrorCamara(error("SecurityError"), undefined)).toBe("permiso-denegado");
  });

  it("NotFoundError and OverconstrainedError mean there is no usable camera", () => {
    expect(claseErrorCamara(error("NotFoundError"), true)).toBe("sin-camara");
    expect(claseErrorCamara(error("OverconstrainedError"), true)).toBe("sin-camara");
  });

  it("NotReadableError means the camera is in use by something else", () => {
    expect(claseErrorCamara(error("NotReadableError"), true)).toBe("en-uso");
  });

  it("a permission error in a document whose policy forbids the camera needs a full reload, not a retry", () => {
    expect(claseErrorCamara(error("NotAllowedError"), false)).toBe("bloqueada-politica");
    expect(claseErrorCamara(error("SecurityError"), false)).toBe("bloqueada-politica");
  });

  it("the policy flag does not turn other errors into a policy block", () => {
    expect(claseErrorCamara(error("NotFoundError"), false)).toBe("sin-camara");
    expect(claseErrorCamara(error("NotReadableError"), false)).toBe("en-uso");
  });

  it("anything else (unknown name, not an Error, null) is a generic error", () => {
    expect(claseErrorCamara(error("AbortError"), true)).toBe("error");
    expect(claseErrorCamara(new Error("boom"), true)).toBe("error");
    expect(claseErrorCamara("texto", true)).toBe("error");
    expect(claseErrorCamara(null, true)).toBe("error");
  });
});

describe("mensajeEstadoCamara: Spanish copy per state", () => {
  it("every state has its own non-empty message, each one mentioning what to do", () => {
    const mensajes = {
      inseguro: mensajeEstadoCamara("inseguro"),
      "sin-api": mensajeEstadoCamara("sin-api"),
      "bloqueada-politica": mensajeEstadoCamara("bloqueada-politica"),
      "permiso-denegado": mensajeEstadoCamara("permiso-denegado"),
      "sin-camara": mensajeEstadoCamara("sin-camara"),
      "en-uso": mensajeEstadoCamara("en-uso"),
      error: mensajeEstadoCamara("error"),
      desconectada: mensajeEstadoCamara("desconectada"),
      pausada: mensajeEstadoCamara("pausada"),
    };
    expect(new Set(Object.values(mensajes)).size).toBe(9);
    expect(mensajes.desconectada).toContain("se desconectó");
    expect(mensajes.pausada).toContain("pausada");
    expect(mensajes.inseguro).toContain("HTTPS");
    expect(mensajes["bloqueada-politica"]).toContain("Recargá la página");
    expect(mensajes["permiso-denegado"]).toContain("permiso");
    expect(mensajes["en-uso"]).toContain("otra aplicación");
    // The manual input always remains the way out.
    for (const mensaje of Object.values(mensajes)) expect(mensaje).toContain("escribir o pegar el link de la receta");
  });
});

describe("evaluarLecturaQr: what to do with each decoded text", () => {
  it("ignores empty or whitespace-only texts", () => {
    expect(evaluarLecturaQr("", 1000, null).veredicto).toBe("vacia");
    expect(evaluarLecturaQr("  \n ", 1000, null).veredicto).toBe("vacia");
  });

  it("accepts a receta URL and a bare hash", () => {
    expect(evaluarLecturaQr(URL_RECETA, 1000, null).veredicto).toBe("receta");
    expect(evaluarLecturaQr(HASH, 1000, null).veredicto).toBe("receta");
  });

  it("flags a QR that carries no receta hash (any other QR in view)", () => {
    expect(evaluarLecturaQr("https://example.org/promo", 1000, null).veredicto).toBe("no-receta");
    expect(evaluarLecturaQr(`https://evil.example/prescripcion/${HASH}`, 1000, null).veredicto).toBe("no-receta");
  });

  it("the same unrecognized text again inside the window is a duplicate, so the hint is not repeated per frame", () => {
    const primera = evaluarLecturaQr("https://example.org/promo", 1000, null);
    expect(primera.veredicto).toBe("no-receta");
    const segunda = evaluarLecturaQr("https://example.org/promo", 1000 + VENTANA_DEDUPE_MS - 1, primera.ultima);
    expect(segunda.veredicto).toBe("duplicada");
    // A duplicate does not extend the window: it is measured from the first sighting.
    expect(segunda.ultima).toEqual(primera.ultima);
  });

  it("the same text after the window is evaluated again", () => {
    const primera = evaluarLecturaQr("https://example.org/promo", 1000, null);
    const despues = evaluarLecturaQr("https://example.org/promo", 1000 + VENTANA_DEDUPE_MS, primera.ultima);
    expect(despues.veredicto).toBe("no-receta");
    expect(despues.ultima).toEqual({ texto: "https://example.org/promo", instante: 1000 + VENTANA_DEDUPE_MS });
  });

  it("a different text inside the window is evaluated, not deduplicated", () => {
    const primera = evaluarLecturaQr("https://example.org/promo", 1000, null);
    const otra = evaluarLecturaQr(URL_RECETA, 1100, primera.ultima);
    expect(otra.veredicto).toBe("receta");
  });

  it("one receta QR seen twice (two frames, or a detector result in flight) is accepted only once", () => {
    const primera = evaluarLecturaQr(URL_RECETA, 5000, null);
    expect(primera.veredicto).toBe("receta");
    expect(evaluarLecturaQr(URL_RECETA, 5050, primera.ultima).veredicto).toBe("duplicada");
  });

  it("dedupes on the trimmed text, so a trailing newline does not defeat it", () => {
    const primera = evaluarLecturaQr(URL_RECETA, 5000, null);
    expect(evaluarLecturaQr(`${URL_RECETA}\n`, 5050, primera.ultima).veredicto).toBe("duplicada");
  });

  it("an empty text leaves the dedupe memory untouched", () => {
    const primera = evaluarLecturaQr("https://example.org/promo", 1000, null);
    const vacia = evaluarLecturaQr("", 1100, primera.ultima);
    expect(vacia.ultima).toEqual(primera.ultima);
  });
});

describe("RESTRICCIONES_CAMARA: what getUserMedia is asked for", () => {
  it("asks for the rear camera and a 1280 px wide frame as preferences (never required), without audio", () => {
    expect(RESTRICCIONES_CAMARA).toEqual({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
  });
});

describe("estadoPermiteReintentar: which problem states offer a retry", () => {
  it("offers it where trying again can work: permission, no camera, in use, generic error, disconnected, paused", () => {
    for (const estado of ["permiso-denegado", "sin-camara", "en-uso", "error", "desconectada", "pausada"] as const satisfies readonly EstadoMensajeCamara[]) {
      expect(estadoPermiteReintentar(estado), estado).toBe(true);
    }
  });

  it("does not offer it where nothing changes by retrying: insecure page, no API, policy block (that one reloads)", () => {
    for (const estado of ["inseguro", "sin-api", "bloqueada-politica"] as const satisfies readonly EstadoMensajeCamara[]) {
      expect(estadoPermiteReintentar(estado), estado).toBe(false);
    }
  });
});

describe("accionTrasFallos: consecutive decoder failures", () => {
  it("keeps going below the limit, whatever the engine", () => {
    for (const fallos of [0, 1, MAX_FALLOS_DETECTOR - 1]) {
      expect(accionTrasFallos(fallos, "barcode-detector")).toBe("seguir");
      expect(accionTrasFallos(fallos, "jsqr")).toBe("seguir");
    }
  });

  it("the native detector failing the limit in a row falls back to jsQR", () => {
    expect(MAX_FALLOS_DETECTOR).toBe(5);
    expect(accionTrasFallos(MAX_FALLOS_DETECTOR, "barcode-detector")).toBe("usar-jsqr");
    expect(accionTrasFallos(MAX_FALLOS_DETECTOR + 3, "barcode-detector")).toBe("usar-jsqr");
  });

  it("jsQR failing the limit in a row is an error (there is nothing left to fall back to)", () => {
    expect(accionTrasFallos(MAX_FALLOS_DETECTOR, "jsqr")).toBe("error");
  });
});

describe("accionTrasObtenerCamara: the tab may be hidden when the permission resolves", () => {
  it("pauses (stops the tracks) when the document is hidden", () => {
    expect(accionTrasObtenerCamara("hidden")).toBe("pausar");
  });

  it("continues when it is visible, or when the browser does not say", () => {
    expect(accionTrasObtenerCamara("visible")).toBe("continuar");
    expect(accionTrasObtenerCamara("")).toBe("continuar");
  });
});

describe("esQrNoReceta / pistaVigente: the 'not a receta' hint", () => {
  it("is a QR that carries text but no receta hash; empty text and recetas are not", () => {
    expect(esQrNoReceta("https://example.org/promo")).toBe(true);
    expect(esQrNoReceta(`  ${URL_RECETA}\n`)).toBe(false);
    expect(esQrNoReceta(HASH)).toBe(false);
    expect(esQrNoReceta("   ")).toBe(false);
  });

  it("stays for about 3 s after the last time that text was seen, then expires", () => {
    expect(VIGENCIA_PISTA_MS).toBe(3000);
    expect(pistaVigente(1000, 1000)).toBe(true);
    expect(pistaVigente(1000, 1000 + VIGENCIA_PISTA_MS - 1)).toBe(true);
    expect(pistaVigente(1000, 1000 + VIGENCIA_PISTA_MS)).toBe(false);
  });

  it("without a pending hint there is nothing to show", () => {
    expect(pistaVigente(null, 5000)).toBe(false);
  });
});

describe("dimensionesFrame: the canvas size for a video frame", () => {
  it("keeps frames at or below the maximum width as they are", () => {
    expect(dimensionesFrame(640, 480, 640)).toEqual({ ancho: 640, alto: 480 });
    expect(dimensionesFrame(320, 240, 640)).toEqual({ ancho: 320, alto: 240 });
  });

  it("scales a wider frame down to the maximum width, keeping the aspect ratio in whole pixels", () => {
    expect(dimensionesFrame(1280, 720, 640)).toEqual({ ancho: 640, alto: 360 });
    expect(dimensionesFrame(1920, 1081, 640)).toEqual({ ancho: 640, alto: 360 });
    expect(dimensionesFrame(1280, 1920, 640)).toEqual({ ancho: 640, alto: 960 });
  });

  it("the same video size always gives the same answer, so the canvas only needs resizing when the video size changes", () => {
    expect(dimensionesFrame(1280, 720, 640)).toEqual(dimensionesFrame(1280, 720, 640));
  });
});

describe("enviarFormulario: requestSubmit with a fallback for Safari < 16", () => {
  it("uses requestSubmit when the browser has it", () => {
    const requestSubmit = vi.fn();
    const click = vi.fn();
    enviarFormulario({ requestSubmit, querySelector: () => ({ click }) });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });

  it("clicks the form's submit button when requestSubmit is not a function", () => {
    const click = vi.fn();
    const querySelector = vi.fn(() => ({ click }));
    enviarFormulario({ querySelector });
    expect(querySelector).toHaveBeenCalledWith('button[type="submit"]');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("does nothing (and does not throw) when there is neither requestSubmit nor a submit button", () => {
    expect(() => enviarFormulario({ querySelector: () => null })).not.toThrow();
  });
});
