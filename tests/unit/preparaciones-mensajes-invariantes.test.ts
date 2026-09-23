/**
 * Unit tests for `modules/preparaciones/domain/mensajes-invariantes.ts`
 * (FASE 8 point 8.3: "map every DB invariant error to a clear Spanish
 * message"). Every code the task explicitly lists (INV-S02/S03/S10/S12,
 * INV-P04, INV-C03, INV-L*) must resolve to a message that is NOT the raw
 * English trigger text and NOT the generic fallback.
 */
import { describe, it, expect } from "vitest";
import { mensajeParaInvariante, MENSAJES_INVARIANTES_CONFIRMACION } from "@/modules/preparaciones/domain/mensajes-invariantes";

const CODIGOS_REQUERIDOS = ["INV-S02", "INV-S03", "INV-S10", "INV-S12", "INV-P04", "INV-C03", "INV-L03", "INV-L04", "INV-L08"];

describe("mensajeParaInvariante", () => {
  for (const codigo of CODIGOS_REQUERIDOS) {
    it(`maps ${codigo} to a specific Spanish message (not the generic fallback)`, () => {
      const mensaje = mensajeParaInvariante(codigo);
      expect(mensaje).toBeTruthy();
      expect(mensaje).not.toContain("se violó una regla del sistema"); // the generic fallback's own wording
      expect(mensaje.toUpperCase()).not.toContain("RAISE EXCEPTION");
    });
  }

  it("every listed message is non-empty and reasonably short (a single clear sentence, not a dump)", () => {
    for (const mensaje of Object.values(MENSAJES_INVARIANTES_CONFIRMACION)) {
      expect(mensaje.length).toBeGreaterThan(10);
      expect(mensaje.length).toBeLessThan(300);
    }
  });

  it("falls back to a generic (but still Spanish, still non-empty) message for an unknown code", () => {
    const mensaje = mensajeParaInvariante("INV-DOES-NOT-EXIST");
    expect(mensaje).toBeTruthy();
    expect(mensaje).toContain("No se pudo confirmar la preparación");
  });

  it("never returns the raw invariant code as the whole message", () => {
    for (const codigo of CODIGOS_REQUERIDOS) {
      expect(mensajeParaInvariante(codigo)).not.toBe(codigo);
    }
  });
});
