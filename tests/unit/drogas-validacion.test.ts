/**
 * Unit tests for `modules/drogas/domain/droga.ts` (FASE 4 point 4.2):
 * tipoControlValido (mirrors migration 0007's CHECK), nonNegativeDecimalString,
 * and DP-12's conservative `puedeCambiarClasificacion` rule.
 */
import { describe, it, expect } from "vitest";
import { tipoControlValido, puedeCambiarClasificacion, nonNegativeDecimalString } from "@/modules/drogas/domain/droga";

describe("tipoControlValido (mirrors droga_es_controlada_check)", () => {
  it("accepts esControlada=false with tipoControl=NINGUNO", () => {
    expect(tipoControlValido(false, "NINGUNO")).toBe(true);
  });
  it("accepts esControlada=true with a real tipoControl", () => {
    expect(tipoControlValido(true, "PSICOTROPICO")).toBe(true);
    expect(tipoControlValido(true, "ESTUPEFACIENTE")).toBe(true);
  });
  it("rejects esControlada=true with tipoControl=NINGUNO", () => {
    expect(tipoControlValido(true, "NINGUNO")).toBe(false);
  });
  it("rejects esControlada=false with a real tipoControl", () => {
    expect(tipoControlValido(false, "PSICOTROPICO")).toBe(false);
    expect(tipoControlValido(false, "ESTUPEFACIENTE")).toBe(false);
  });
});

describe("puedeCambiarClasificacion (DP-12, task's conservative rule)", () => {
  it("allows changing classification when the droga has no partidas", () => {
    expect(puedeCambiarClasificacion(false)).toBe(true);
  });
  it("rejects changing classification once the droga has any partida", () => {
    expect(puedeCambiarClasificacion(true)).toBe(false);
  });
});

describe("nonNegativeDecimalString (mirrors droga_stock_minimo_check)", () => {
  it("accepts zero and positive decimals", () => {
    expect(nonNegativeDecimalString.safeParse("0").success).toBe(true);
    expect(nonNegativeDecimalString.safeParse("10.5").success).toBe(true);
  });
  it("rejects negative values", () => {
    const result = nonNegativeDecimalString.safeParse("-1");
    expect(result.success).toBe(false);
  });
  it("rejects non-numeric input", () => {
    expect(nonNegativeDecimalString.safeParse("abc").success).toBe(false);
  });
  it("rejects an empty string", () => {
    expect(nonNegativeDecimalString.safeParse("").success).toBe(false);
  });
});
