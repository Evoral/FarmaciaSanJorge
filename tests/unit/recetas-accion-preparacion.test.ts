/**
 * modules/recetas/domain/accion-preparacion.ts: the /recetas list's
 * "Preparar" / "Continuar" / "Generar ficha" decision and its "ítem N de M"
 * label.
 */
import { describe, it, expect } from "vitest";
import { decidirAccionPreparacion } from "@/modules/recetas/domain/accion-preparacion";
import type { ItemParaPreparar } from "@/modules/recetas/domain/accion-preparacion";

function item(overrides: Partial<ItemParaPreparar> = {}): ItemParaPreparar {
  return { itemRecetaId: "i", fichaVigenteId: "f", preparacionIniciadaId: null, tieneConfirmada: false, ...overrides };
}

describe("decidirAccionPreparacion", () => {
  it("one item with a ficha -> Preparar on its latest ficha", () => {
    expect(decidirAccionPreparacion({ estado: "PENDIENTE_PREPARACION", items: [item({ fichaVigenteId: "f1" })], puedeIniciar: true })).toEqual({
      tipo: "preparar",
      fichaTecnicaId: "f1",
      etiqueta: "Preparar",
    });
  });

  it("an INICIADA preparación -> Continuar preparación (link)", () => {
    expect(decidirAccionPreparacion({ estado: "EN_PREPARACION", items: [item({ preparacionIniciadaId: "p1" })], puedeIniciar: true })).toEqual({
      tipo: "continuar",
      preparacionId: "p1",
      etiqueta: "Continuar preparación",
    });
  });

  it("several items: acts on the first one not confirmed, labelled N de M", () => {
    const items = [item({ tieneConfirmada: true }), item({ fichaVigenteId: "f2" }), item({ fichaVigenteId: "f3" })];
    expect(decidirAccionPreparacion({ estado: "EN_PREPARACION", items, puedeIniciar: true })).toEqual({
      tipo: "preparar",
      fichaTecnicaId: "f2",
      etiqueta: "Preparar ítem 2 de 3",
    });
    const conIniciada = [item({ tieneConfirmada: true }), item({ preparacionIniciadaId: "p2" })];
    expect(decidirAccionPreparacion({ estado: "EN_PREPARACION", items: conIniciada, puedeIniciar: true })).toMatchObject({
      tipo: "continuar",
      etiqueta: "Continuar ítem 2 de 2",
    });
  });

  it("the pending item has no ficha -> a link to generate it", () => {
    expect(decidirAccionPreparacion({ estado: "PENDIENTE_PREPARACION", items: [item({ fichaVigenteId: null })], puedeIniciar: true })).toEqual({
      tipo: "generar-ficha",
      etiqueta: "Generar ficha",
    });
  });

  it("nothing: terminal receta, every item done, or no preparaciones.iniciar", () => {
    expect(decidirAccionPreparacion({ estado: "ANULADA", items: [item()], puedeIniciar: true })).toEqual({ tipo: "ninguna" });
    expect(decidirAccionPreparacion({ estado: "ENTREGADA", items: [item()], puedeIniciar: true })).toEqual({ tipo: "ninguna" });
    expect(decidirAccionPreparacion({ estado: "PREPARADA", items: [item({ tieneConfirmada: true })], puedeIniciar: true })).toEqual({ tipo: "ninguna" });
    expect(decidirAccionPreparacion({ estado: "PENDIENTE_PREPARACION", items: [item()], puedeIniciar: false })).toEqual({ tipo: "ninguna" });
    expect(decidirAccionPreparacion({ estado: "PENDIENTE_PREPARACION", items: [], puedeIniciar: true })).toEqual({ tipo: "ninguna" });
  });
});
