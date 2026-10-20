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
  mensajeRepartidorSegunModalidad,
  recetaTieneDomicilio,
  validarDomicilioParaEnvio,
  validarRepartidorAsignable,
  puedeCambiarRepartidor,
  MENSAJE_ENVIO_SIN_REPARTIDOR,
  MENSAJE_RETIRO_CON_REPARTIDOR,
  MENSAJE_ENVIO_SIN_DOMICILIO,
  MENSAJE_REPARTIDOR_INACTIVO,
  MENSAJE_REPARTIDOR_NO_ENCONTRADO,
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

describe("mensajeRepartidorSegunModalidad (E1/E2)", () => {
  it("an ENVIO needs a repartidor: missing or empty is refused", () => {
    expect(mensajeRepartidorSegunModalidad("ENVIO", undefined)).toBe(MENSAJE_ENVIO_SIN_REPARTIDOR);
    expect(mensajeRepartidorSegunModalidad("ENVIO", null)).toBe(MENSAJE_ENVIO_SIN_REPARTIDOR);
    expect(mensajeRepartidorSegunModalidad("ENVIO", "")).toBe(MENSAJE_ENVIO_SIN_REPARTIDOR);
  });

  it("an ENVIO with a repartidor is valid", () => {
    expect(mensajeRepartidorSegunModalidad("ENVIO", "44444444-4444-4444-a444-444444444444")).toBeNull();
  });

  it("a RETIRO_PRESENCIAL carries none: a repartidor is refused, its absence is valid", () => {
    expect(mensajeRepartidorSegunModalidad("RETIRO_PRESENCIAL", "44444444-4444-4444-a444-444444444444")).toBe(MENSAJE_RETIRO_CON_REPARTIDOR);
    expect(mensajeRepartidorSegunModalidad("RETIRO_PRESENCIAL", undefined)).toBeNull();
    expect(mensajeRepartidorSegunModalidad("RETIRO_PRESENCIAL", null)).toBeNull();
    expect(mensajeRepartidorSegunModalidad("RETIRO_PRESENCIAL", "")).toBeNull();
  });
});

describe("recetaTieneDomicilio / validarDomicilioParaEnvio (E4)", () => {
  it("null, empty and whitespace-only mean there is no domicilio", () => {
    expect(recetaTieneDomicilio(null)).toBe(false);
    expect(recetaTieneDomicilio(undefined)).toBe(false);
    expect(recetaTieneDomicilio("")).toBe(false);
    expect(recetaTieneDomicilio("   ")).toBe(false);
    expect(recetaTieneDomicilio("Calle Falsa 123")).toBe(true);
  });

  it("throws the sin-domicilio message for a receta without one, and passes otherwise", () => {
    expect(() => validarDomicilioParaEnvio(null)).toThrow(ValidationError);
    expect(() => validarDomicilioParaEnvio("  ")).toThrow(MENSAJE_ENVIO_SIN_DOMICILIO);
    expect(() => validarDomicilioParaEnvio("Calle Falsa 123")).not.toThrow();
  });
});

describe("validarRepartidorAsignable (E3)", () => {
  it("refuses a repartidor that does not exist in the tenant, pointing at the repartidor field", () => {
    expect(() => validarRepartidorAsignable(null)).toThrow(MENSAJE_REPARTIDOR_NO_ENCONTRADO);
    try {
      validarRepartidorAsignable(null);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields).toEqual(["repartidorId"]);
    }
  });

  it("refuses an inactive repartidor and accepts an active one", () => {
    expect(() => validarRepartidorAsignable({ activo: false })).toThrow(MENSAJE_REPARTIDOR_INACTIVO);
    expect(() => validarRepartidorAsignable({ activo: true })).not.toThrow();
  });
});

describe("puedeCambiarRepartidor (E5)", () => {
  it("is valid ONLY from ENVIADA_PEND_FIRMA", () => {
    expect(puedeCambiarRepartidor("ENVIADA_PEND_FIRMA")).toBe(true);
    expect(puedeCambiarRepartidor("PREPARADA")).toBe(false);
    expect(puedeCambiarRepartidor("ENTREGADA")).toBe(false);
    expect(puedeCambiarRepartidor("ANULADA")).toBe(false);
  });
});
