/**
 * Unit tests for `modules/recetas/domain/receta.ts` (FASE 6 points
 * 6.1/6.3/6.5): V1-V9 (minus V5, deliberately out of scope -- see that
 * file's doc comment), the state machine helpers (mirroring migration
 * 0011's DB trigger), the fecha_prescripcion check, and the origen gate
 * (DP-29/point 6.2 excluded -- only PRESENCIAL is accepted for now).
 */
import { describe, it, expect } from "vitest";
import {
  ORIGENES_HABILITADOS,
  esEstadoEditable,
  esEstadoTerminal,
  esFechaPrescripcionValida,
  puedeAnular,
  validarItemsReceta,
  validarOrigenHabilitado,
} from "@/modules/recetas/domain/receta";
import type { ComponenteInput, ItemInput } from "@/modules/recetas/domain/receta";
import { ValidationError } from "@/shared/errors";

function componente(overrides: Partial<ComponenteInput> = {}): ComponenteInput {
  return {
    drogaId: "11111111-1111-4111-a111-111111111111",
    cantidad: "5",
    unidadMedidaId: "22222222-2222-4222-a222-222222222222",
    modoExpresion: "TOTAL",
    esPrincipioActivo: true,
    ...overrides,
  };
}

function item(overrides: Partial<ItemInput> = {}, componentes: ComponenteInput[] = [componente()]): ItemInput {
  return {
    descripcion: "Crema",
    formaFarmaceutica: "CREMA",
    cantidadUnidades: 1,
    fraccionDosisPorUnidad: "1",
    cantidadTotal: null,
    unidadTotalId: null,
    observaciones: null,
    componentes,
    ...overrides,
  };
}

describe("validarItemsReceta -- INV-R01 (receta sin items)", () => {
  it("rejects an empty items array", () => {
    expect(() => validarItemsReceta([])).toThrow(ValidationError);
  });

  it("accepts a single valid item", () => {
    expect(() => validarItemsReceta([item()])).not.toThrow();
  });
});

describe("validarItemsReceta -- V1 (item sin componentes)", () => {
  it("rejects an item with zero componentes", () => {
    expect(() => validarItemsReceta([item({}, [])])).toThrow(/V1/);
  });
});

describe("validarItemsReceta -- V2 (mas de un CSP)", () => {
  it("rejects two CSP componentes in the same item", () => {
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    expect(() => validarItemsReceta([item({}, [csp, { ...csp }])])).toThrow(/V2/);
  });

  it("accepts exactly one CSP componente", () => {
    const total = componente({ modoExpresion: "TOTAL", cantidad: "5" });
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    expect(() => validarItemsReceta([item({ formaFarmaceutica: "CAPSULA" }, [total, csp])])).not.toThrow();
  });
});

describe("validarItemsReceta -- V3 (CSP debe ser el ultimo)", () => {
  it("rejects a CSP componente that is NOT last in the list", () => {
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    const total = componente({ modoExpresion: "TOTAL", cantidad: "5" });
    expect(() => validarItemsReceta([item({ formaFarmaceutica: "CAPSULA" }, [csp, total])])).toThrow(/V3/);
  });

  it("accepts a CSP componente that IS last", () => {
    const total = componente({ modoExpresion: "TOTAL", cantidad: "5" });
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    expect(() => validarItemsReceta([item({ formaFarmaceutica: "CAPSULA" }, [total, csp])])).not.toThrow();
  });
});

describe("validarItemsReceta -- V4 (CSP en forma no capsular requiere total)", () => {
  it("rejects a CSP on a non-capsular form with no cantidadTotal/unidadTotalId", () => {
    const total = componente({ modoExpresion: "TOTAL", cantidad: "5" });
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    expect(() =>
      validarItemsReceta([item({ formaFarmaceutica: "CREMA", cantidadTotal: null, unidadTotalId: null }, [total, csp])]),
    ).toThrow(/V4/);
  });

  it("accepts a CSP on a non-capsular form WITH cantidadTotal/unidadTotalId", () => {
    const total = componente({ modoExpresion: "TOTAL", cantidad: "5" });
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    expect(() =>
      validarItemsReceta([
        item({ formaFarmaceutica: "CREMA", cantidadTotal: "30", unidadTotalId: "33333333-3333-4333-a333-333333333333" }, [total, csp]),
      ]),
    ).not.toThrow();
  });

  it("does NOT require cantidadTotal for a CSP on a CAPSULA form (T3's clarification)", () => {
    const total = componente({ modoExpresion: "TOTAL", cantidad: "5" });
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    expect(() =>
      validarItemsReceta([item({ formaFarmaceutica: "CAPSULA", cantidadTotal: null, unidadTotalId: null }, [total, csp])]),
    ).not.toThrow();
  });
});

describe("validarItemsReceta -- V6/V7 (cantidad segun modoExpresion)", () => {
  it("V6: rejects TOTAL/POR_DOSIS with cantidad null", () => {
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "TOTAL", cantidad: null })])])).toThrow(/V6/);
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "POR_DOSIS", cantidad: null })])])).toThrow(/V6/);
  });

  it("V6: rejects TOTAL with cantidad <= 0", () => {
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "TOTAL", cantidad: "0" })])])).toThrow(/V6/);
  });

  it("V7: rejects CS with a non-null cantidad", () => {
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "CS", cantidad: "5" })])])).toThrow(/V7/);
  });

  it("accepts CS with cantidad null", () => {
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "CS", cantidad: null })])])).not.toThrow();
  });
});

describe("validarItemsReceta -- V8 (fraccionDosisPorUnidad en (0,1])", () => {
  it("rejects 0", () => {
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "0" })])).toThrow(/V8/);
  });

  it("rejects > 1", () => {
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "1.5" })])).toThrow(/V8/);
  });

  it("accepts exactly 1 and 0.5", () => {
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "1" })])).not.toThrow();
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "0.5" })])).not.toThrow();
  });
});

describe("validarItemsReceta -- V9 (cantidadUnidades entero > 0)", () => {
  it("rejects 0", () => {
    expect(() => validarItemsReceta([item({ cantidadUnidades: 0 })])).toThrow(/V9/);
  });

  it("rejects a non-integer", () => {
    expect(() => validarItemsReceta([item({ cantidadUnidades: 1.5 })])).toThrow(/V9/);
  });

  it("accepts a positive integer", () => {
    expect(() => validarItemsReceta([item({ cantidadUnidades: 30 })])).not.toThrow();
  });
});

describe("esEstadoTerminal / puedeAnular / esEstadoEditable -- INV-R08 mirror", () => {
  it("ENTREGADA and ANULADA are terminal", () => {
    expect(esEstadoTerminal("ENTREGADA")).toBe(true);
    expect(esEstadoTerminal("ANULADA")).toBe(true);
  });

  it("every other estado is non-terminal", () => {
    expect(esEstadoTerminal("PENDIENTE_PREPARACION")).toBe(false);
    expect(esEstadoTerminal("EN_PREPARACION")).toBe(false);
    expect(esEstadoTerminal("PREPARADA")).toBe(false);
    expect(esEstadoTerminal("LISTA_PARA_RETIRAR")).toBe(false);
    expect(esEstadoTerminal("ENVIADA_PEND_FIRMA")).toBe(false);
  });

  it("puedeAnular is the negation of esEstadoTerminal (ANULADA reachable from any non-terminal state)", () => {
    expect(puedeAnular("PENDIENTE_PREPARACION")).toBe(true);
    expect(puedeAnular("LISTA_PARA_RETIRAR")).toBe(true);
    expect(puedeAnular("ENTREGADA")).toBe(false);
    expect(puedeAnular("ANULADA")).toBe(false);
  });

  it("only PENDIENTE_PREPARACION is editable (6.3 binding decision)", () => {
    expect(esEstadoEditable("PENDIENTE_PREPARACION")).toBe(true);
    expect(esEstadoEditable("EN_PREPARACION")).toBe(false);
    expect(esEstadoEditable("ENTREGADA")).toBe(false);
    expect(esEstadoEditable("ANULADA")).toBe(false);
  });
});

describe("esFechaPrescripcionValida", () => {
  it("accepts a date equal to today's jornada", () => {
    expect(esFechaPrescripcionValida("2026-06-15", "2026-06-15")).toBe(true);
  });

  it("accepts a date in the past", () => {
    expect(esFechaPrescripcionValida("2026-06-01", "2026-06-15")).toBe(true);
  });

  it("rejects a future date", () => {
    expect(esFechaPrescripcionValida("2026-06-16", "2026-06-15")).toBe(false);
  });
});

describe("validarOrigenHabilitado -- point 6.2 (adjuntos) excluded", () => {
  it("PRESENCIAL is the only habilitado origen", () => {
    expect(ORIGENES_HABILITADOS).toEqual(["PRESENCIAL"]);
  });

  it("does not throw for PRESENCIAL", () => {
    expect(() => validarOrigenHabilitado("PRESENCIAL")).not.toThrow();
  });

  it("rejects DIGITAL_PDF with a 'pendiente: carga de adjuntos' message", () => {
    expect(() => validarOrigenHabilitado("DIGITAL_PDF")).toThrow(/pendiente: carga de adjuntos/);
  });

  it("rejects DIGITAL_FOTO with a 'pendiente: carga de adjuntos' message", () => {
    expect(() => validarOrigenHabilitado("DIGITAL_FOTO")).toThrow(/pendiente: carga de adjuntos/);
  });
});
