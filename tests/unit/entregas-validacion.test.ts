/**
 * Pure domain tests for FASE 11 (M14, modules/entregas/domain/entrega.ts).
 * No I/O, no mocks needed -- see tests/unit/recetas-validacion.test.ts for
 * the same "pure function, direct assertions" shape.
 */
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/shared/errors";
import {
  puedeRegistrarEntrega,
  puedeMarcarListaParaRetirar,
  puedeConfirmarFirmaRecibida,
  calcularItemsEntregables,
  validarTieneItemsEntregables,
  requiereRegistrarRecepcionFisicaAhora,
  estadoDestinoEntrega,
  esVencidaRegularizacion,
} from "@/modules/entregas/domain/entrega";

describe("puedeRegistrarEntrega / puedeMarcarListaParaRetirar / puedeConfirmarFirmaRecibida", () => {
  it("registrar entrega is valid from PREPARADA or LISTA_PARA_RETIRAR only", () => {
    expect(puedeRegistrarEntrega("PREPARADA")).toBe(true);
    expect(puedeRegistrarEntrega("LISTA_PARA_RETIRAR")).toBe(true);
    expect(puedeRegistrarEntrega("EN_PREPARACION")).toBe(false);
    expect(puedeRegistrarEntrega("ENVIADA_PEND_FIRMA")).toBe(false);
    expect(puedeRegistrarEntrega("ENTREGADA")).toBe(false);
    expect(puedeRegistrarEntrega("ANULADA")).toBe(false);
  });

  it("marcar lista para retirar is valid ONLY from PREPARADA", () => {
    expect(puedeMarcarListaParaRetirar("PREPARADA")).toBe(true);
    expect(puedeMarcarListaParaRetirar("LISTA_PARA_RETIRAR")).toBe(false);
    expect(puedeMarcarListaParaRetirar("EN_PREPARACION")).toBe(false);
  });

  it("confirmar firma recibida is valid ONLY from ENVIADA_PEND_FIRMA", () => {
    expect(puedeConfirmarFirmaRecibida("ENVIADA_PEND_FIRMA")).toBe(true);
    expect(puedeConfirmarFirmaRecibida("LISTA_PARA_RETIRAR")).toBe(false);
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

describe("requiereRegistrarRecepcionFisicaAhora (user decision 5, RETIRO_PRESENCIAL + INV-R07)", () => {
  it("false for ENVIO regardless of the checkbox", () => {
    expect(requiereRegistrarRecepcionFisicaAhora("ENVIO", false, false)).toBe(false);
    expect(requiereRegistrarRecepcionFisicaAhora("ENVIO", false, true)).toBe(false);
  });

  it("false for RETIRO_PRESENCIAL when receta_fisica_recibida is already true", () => {
    expect(requiereRegistrarRecepcionFisicaAhora("RETIRO_PRESENCIAL", true, false)).toBe(false);
  });

  it("throws for RETIRO_PRESENCIAL + not yet recibida + checkbox NOT ticked", () => {
    expect(() => requiereRegistrarRecepcionFisicaAhora("RETIRO_PRESENCIAL", false, false)).toThrow(ValidationError);
  });

  it("true for RETIRO_PRESENCIAL + not yet recibida + checkbox ticked", () => {
    expect(requiereRegistrarRecepcionFisicaAhora("RETIRO_PRESENCIAL", false, true)).toBe(true);
  });
});

describe("estadoDestinoEntrega", () => {
  it("RETIRO_PRESENCIAL -> ENTREGADA, ENVIO -> ENVIADA_PEND_FIRMA", () => {
    expect(estadoDestinoEntrega("RETIRO_PRESENCIAL")).toBe("ENTREGADA");
    expect(estadoDestinoEntrega("ENVIO")).toBe("ENVIADA_PEND_FIRMA");
  });
});

describe("esVencidaRegularizacion (DP-15)", () => {
  it("vencida only when antiguedad STRICTLY exceeds the plazo", () => {
    expect(esVencidaRegularizacion(7, 7)).toBe(false);
    expect(esVencidaRegularizacion(8, 7)).toBe(true);
    expect(esVencidaRegularizacion(0, 0)).toBe(false);
    expect(esVencidaRegularizacion(1, 0)).toBe(true);
  });
});
