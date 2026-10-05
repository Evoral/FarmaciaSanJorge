/**
 * Unit tests for modules/recetas/ui/foco-lectura.ts: when the QR panel may
 * take the focus back once a reading finishes. The component itself cannot be
 * rendered here (vitest runs in node, without a DOM), so the decision is a
 * pure function over the active element; the wiring is checked by hand (see
 * docs/specs/importacion-receta-qr.md, "verificación manual").
 */
import { describe, it, expect } from "vitest";
import { debeRecuperarFoco } from "@/modules/recetas/ui/foco-lectura";

const cuerpo = { nombre: "body" };
const inputDelPanel = { nombre: "input del panel" };
const campoDelFormulario = { nombre: "campo del formulario manual" };
const panel = { contains: (nodo: unknown) => nodo === inputDelPanel };

describe("debeRecuperarFoco", () => {
  it("after a success the panel always takes the focus, wherever it was", () => {
    for (const activo of [cuerpo, null, inputDelPanel, campoDelFormulario]) {
      expect(debeRecuperarFoco({ status: "success", activo, cuerpo, panel })).toBe(true);
    }
  });

  it("after an error it does when nothing meaningful has the focus: body or null", () => {
    expect(debeRecuperarFoco({ status: "error", activo: cuerpo, cuerpo, panel })).toBe(true);
    expect(debeRecuperarFoco({ status: "error", activo: null, cuerpo, panel })).toBe(true);
  });

  it("after an error it does when the focus is still inside the panel", () => {
    expect(debeRecuperarFoco({ status: "error", activo: inputDelPanel, cuerpo, panel })).toBe(true);
  });

  it("after an error it does NOT steal the focus from a field outside the panel (the manual form)", () => {
    expect(debeRecuperarFoco({ status: "error", activo: campoDelFormulario, cuerpo, panel })).toBe(false);
  });

  it("without a panel reference an outside element is still respected", () => {
    expect(debeRecuperarFoco({ status: "error", activo: campoDelFormulario, cuerpo, panel: null })).toBe(false);
    expect(debeRecuperarFoco({ status: "error", activo: cuerpo, cuerpo, panel: null })).toBe(true);
  });
});
