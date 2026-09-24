/**
 * Unit tests for `modules/cierres/domain/motivo-demora.ts` (DP-18c
 * RESUELTA, FASE 10 point 10.1). Pure -- no mocks needed.
 */
import { describe, it, expect } from "vitest";
import { validarMotivoDemoraParaFirma, MOTIVO_DEMORA_VALUES, MOTIVO_DEMORA_LABELS } from "@/modules/cierres/domain/motivo-demora";

describe("MOTIVO_DEMORA_VALUES", () => {
  it("matches the DB enum labels exactly (migration 0039)", () => {
    expect(MOTIVO_DEMORA_VALUES).toEqual(["AUSENCIA_DT", "FALLA_SISTEMA", "FARMACIA_CERRADA", "OTRO"]);
  });

  it("every value has a Spanish label", () => {
    for (const value of MOTIVO_DEMORA_VALUES) {
      expect(MOTIVO_DEMORA_LABELS[value]).toBeTruthy();
    }
  });
});

describe("validarMotivoDemoraParaFirma", () => {
  it("on time: no motivo required regardless of what was sent", () => {
    expect(validarMotivoDemoraParaFirma({ fueraDeTermino: false, motivoDemora: null, motivoDemoraDetalle: null })).toEqual({ ok: true });
  });

  it("out of term without motivo: rejected", () => {
    const result = validarMotivoDemoraParaFirma({ fueraDeTermino: true, motivoDemora: null, motivoDemoraDetalle: null });
    expect(result.ok).toBe(false);
  });

  it("out of term with a non-OTRO motivo and no detalle: accepted", () => {
    expect(validarMotivoDemoraParaFirma({ fueraDeTermino: true, motivoDemora: "AUSENCIA_DT", motivoDemoraDetalle: null })).toEqual({ ok: true });
  });

  it("out of term with OTRO and no detalle: rejected", () => {
    const result = validarMotivoDemoraParaFirma({ fueraDeTermino: true, motivoDemora: "OTRO", motivoDemoraDetalle: "" });
    expect(result.ok).toBe(false);
  });

  it("out of term with OTRO and a blank (whitespace-only) detalle: rejected", () => {
    const result = validarMotivoDemoraParaFirma({ fueraDeTermino: true, motivoDemora: "OTRO", motivoDemoraDetalle: "   " });
    expect(result.ok).toBe(false);
  });

  it("out of term with OTRO and a real detalle: accepted", () => {
    expect(validarMotivoDemoraParaFirma({ fueraDeTermino: true, motivoDemora: "OTRO", motivoDemoraDetalle: "Se rompió el sistema" })).toEqual({ ok: true });
  });
});
