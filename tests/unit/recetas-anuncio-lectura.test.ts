/**
 * Unit tests for modules/recetas/ui/anuncio-lectura.ts: the text of the QR
 * panel's persistent live region (screen readers announce its changes). The
 * component itself (focus, aria attributes) cannot be rendered here -- vitest
 * runs in node, without a DOM -- and is checked by hand (see
 * docs/specs/importacion-receta-qr.md, "verificación manual").
 */
import { describe, it, expect } from "vitest";
import { MENSAJE_ANUNCIO_LEIDA, MENSAJE_ANUNCIO_LEYENDO, textoAnuncioLectura } from "@/modules/recetas/ui/anuncio-lectura";

describe("textoAnuncioLectura", () => {
  it("announces the reading while it is pending, whatever the previous result", () => {
    expect(MENSAJE_ANUNCIO_LEYENDO).toBe("Leyendo…");
    for (const status of ["idle", "error", "success"] as const) {
      expect(textoAnuncioLectura({ isPending: true, status, importando: status === "success" })).toBe(MENSAJE_ANUNCIO_LEYENDO);
    }
  });

  it("announces that the receta was read once the preview is loaded", () => {
    expect(MENSAJE_ANUNCIO_LEIDA).toBe("Receta leída. Revisá la vista previa.");
    expect(textoAnuncioLectura({ isPending: false, status: "success", importando: true })).toBe(MENSAJE_ANUNCIO_LEIDA);
  });

  it("is empty when idle, after an error (the alert says it) or once the import was discarded or replaced", () => {
    expect(textoAnuncioLectura({ isPending: false, status: "idle", importando: false })).toBe("");
    expect(textoAnuncioLectura({ isPending: false, status: "error", importando: false })).toBe("");
    expect(textoAnuncioLectura({ isPending: false, status: "success", importando: false })).toBe("");
  });
});
