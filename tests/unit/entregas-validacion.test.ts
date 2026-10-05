/**
 * Pure domain tests for FASE 11 (M14, modules/entregas/domain/entrega.ts).
 * No I/O, no mocks needed -- see tests/unit/recetas-validacion.test.ts for
 * the same "pure function, direct assertions" shape.
 */
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/shared/errors";
import {
  puedeRegistrarEntrega,
  puedeConfirmarFirmaRecibida,
  calcularItemsEntregables,
  validarTieneItemsEntregables,
  estadoDestinoEntrega,
} from "@/modules/entregas/domain/entrega";

describe("puedeRegistrarEntrega / puedeConfirmarFirmaRecibida", () => {
  it("registrar entrega is valid from PREPARADA only", () => {
    expect(puedeRegistrarEntrega("PREPARADA")).toBe(true);
    expect(puedeRegistrarEntrega("EN_PREPARACION")).toBe(false);
    expect(puedeRegistrarEntrega("ENVIADA_PEND_FIRMA")).toBe(false);
    expect(puedeRegistrarEntrega("ENTREGADA")).toBe(false);
    expect(puedeRegistrarEntrega("ANULADA")).toBe(false);
  });

  it("confirmar firma recibida is valid ONLY from ENVIADA_PEND_FIRMA", () => {
    expect(puedeConfirmarFirmaRecibida("ENVIADA_PEND_FIRMA")).toBe(true);
    expect(puedeConfirmarFirmaRecibida("PREPARADA")).toBe(false);
    expect(puedeConfirmarFirmaRecibida("ENTREGADA")).toBe(false);
  });
});

describe("calcularItemsEntregables / validarTieneItemsEntregables", () => {
  it("VIGENTE items are deliverable; SIN_EFECTO and PENDIENTE are excluded", () => {
    const { entregables, excluidos } = calcularItemsEntregables([
      { id: "a", estadoAsiento: "VIGENTE" },
      { id: "b", estadoAsiento: "SIN_EFECTO" },
      { id: "c", estadoAsiento: "PENDIENTE" },
    ]);
    expect(entregables).toEqual(["a"]);
    expect(excluidos).toEqual(["b", "c"]);
  });

  it("throws when every item is excluded (nothing to deliver)", () => {
    expect(() => validarTieneItemsEntregables([{ id: "a", estadoAsiento: "SIN_EFECTO" }])).toThrow(ValidationError);
  });

  it("does not throw when at least one item is VIGENTE", () => {
    expect(() => validarTieneItemsEntregables([{ id: "a", estadoAsiento: "VIGENTE" }, { id: "b", estadoAsiento: "SIN_EFECTO" }])).not.toThrow();
  });
});

describe("estadoDestinoEntrega", () => {
  it("RETIRO_PRESENCIAL -> ENTREGADA, ENVIO -> ENVIADA_PEND_FIRMA", () => {
    expect(estadoDestinoEntrega("RETIRO_PRESENCIAL")).toBe("ENTREGADA");
    expect(estadoDestinoEntrega("ENVIO")).toBe("ENVIADA_PEND_FIRMA");
  });
});
