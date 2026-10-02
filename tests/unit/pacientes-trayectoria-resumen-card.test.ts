/**
 * Unit tests for the collapsed-summary helpers of the Trayectoria receta
 * card (`etapaActual`, `resumenItems` in modules/pacientes/domain/trayectoria.ts).
 */
import { describe, it, expect } from "vitest";
import { etapaActual, resumenItems } from "@/modules/pacientes/domain/trayectoria";
import type { ItemTrayectoria, PasoTrayectoria } from "@/modules/pacientes/domain/trayectoria";

const paso = (p: PasoTrayectoria["paso"], estado: PasoTrayectoria["estado"]): PasoTrayectoria => ({ paso: p, estado });

describe("etapaActual", () => {
  it("returns the first step that is not complete", () => {
    const pasos = [paso("INGRESO", "COMPLETO"), paso("PREPARACION", "COMPLETO"), paso("LIBRO", "EN_CURSO"), paso("ENTREGA", "PENDIENTE")];
    expect(etapaActual(pasos)).toEqual(paso("LIBRO", "EN_CURSO"));
  });

  it("skips NO_APLICA steps", () => {
    const pasos = [paso("INGRESO", "COMPLETO"), paso("PREPARACION", "NO_APLICA"), paso("ENTREGA", "PENDIENTE")];
    expect(etapaActual(pasos)).toEqual(paso("ENTREGA", "PENDIENTE"));
  });

  it("stops at a SIN_EFECTO step (it needs attention)", () => {
    const pasos = [paso("INGRESO", "COMPLETO"), paso("LIBRO", "SIN_EFECTO"), paso("ENTREGA", "PENDIENTE")];
    expect(etapaActual(pasos)).toEqual(paso("LIBRO", "SIN_EFECTO"));
  });

  it("returns null when every step is complete or not applicable", () => {
    expect(etapaActual([paso("INGRESO", "COMPLETO"), paso("ARCHIVO", "NO_APLICA")])).toBeNull();
    expect(etapaActual([])).toBeNull();
  });
});

describe("resumenItems", () => {
  const item = (id: string) => ({ id }) as ItemTrayectoria;

  it("returns the first item and how many more there are", () => {
    expect(resumenItems([item("a"), item("b"), item("c")])).toEqual({ primero: item("a"), restantes: 2 });
    expect(resumenItems([item("a")])).toEqual({ primero: item("a"), restantes: 0 });
  });

  it("returns null without items", () => {
    expect(resumenItems([])).toBeNull();
  });
});
