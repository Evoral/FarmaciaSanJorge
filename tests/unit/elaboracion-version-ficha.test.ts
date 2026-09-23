/** `siguienteVersionFicha` (FASE 7 point 7.2). See modules/elaboracion/domain/version.ts's doc comment for what this function is (and is NOT) responsible for -- the concurrency guarantee is covered separately by tests/db/fichas-tecnicas-generacion.test.ts. */
import { describe, it, expect } from "vitest";
import { siguienteVersionFicha } from "@/modules/elaboracion/domain/version";
import { DomainError } from "@/shared/errors";

describe("siguienteVersionFicha", () => {
  it("returns 1 for an item with no ficha yet (maxVersionActual = 0)", () => {
    expect(siguienteVersionFicha(0)).toBe(1);
  });

  it("returns max + 1 for an item that already has fichas", () => {
    expect(siguienteVersionFicha(1)).toBe(2);
    expect(siguienteVersionFicha(4)).toBe(5);
    expect(siguienteVersionFicha(41)).toBe(42);
  });

  it("rejects a negative maxVersionActual (would only happen from a bug upstream)", () => {
    expect(() => siguienteVersionFicha(-1)).toThrow(DomainError);
  });

  it("rejects a non-integer maxVersionActual", () => {
    expect(() => siguienteVersionFicha(1.5)).toThrow(DomainError);
  });
});
