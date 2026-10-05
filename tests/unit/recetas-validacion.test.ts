/**
 * Unit tests for `modules/recetas/domain/receta.ts` (FASE 6 points
 * 6.1/6.3/6.5): V1-V9 (minus V5, deliberately out of scope -- see that
 * file's doc comment), the state machine helpers (mirroring migration
 * 0011's DB trigger), the fecha_prescripcion check, the origen gates
 * (DP-29: DIGITAL_PDF enabled via the PDF import, DIGITAL_FOTO still out
 * of scope -- docs/specs/importacion-receta-pdf.md), the diagnóstico
 * (CIE-10) format and the item's duración del tratamiento.
 */
import { describe, it, expect } from "vitest";
import {
  ORIGENES_HABILITADOS,
  diagnosticoCodigoOpcional,
  duracionTratamientoDiasOpcional,
  esDiagnosticoCodigoValido,
  esEstadoEditable,
  esEstadoTerminal,
  esFechaPrescripcionValida,
  puedeAnular,
  validarItemsReceta,
  validarOrigenCargaManual,
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
    expect(() => validarItemsReceta([item({}, [])])).toThrow(expect.objectContaining({ regla: "V1" }));
  });
});

describe("validarItemsReceta -- V2 (mas de un CSP)", () => {
  it("rejects two CSP componentes in the same item", () => {
    const csp = componente({ modoExpresion: "CSP", cantidad: null });
    expect(() => validarItemsReceta([item({}, [csp, { ...csp }])])).toThrow(expect.objectContaining({ regla: "V2" }));
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
    expect(() => validarItemsReceta([item({ formaFarmaceutica: "CAPSULA" }, [csp, total])])).toThrow(expect.objectContaining({ regla: "V3" }));
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
    ).toThrow(expect.objectContaining({ regla: "V4" }));
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
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "TOTAL", cantidad: null })])])).toThrow(expect.objectContaining({ regla: "V6" }));
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "POR_DOSIS", cantidad: null })])])).toThrow(expect.objectContaining({ regla: "V6" }));
  });

  it("V6: rejects TOTAL with cantidad <= 0", () => {
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "TOTAL", cantidad: "0" })])])).toThrow(expect.objectContaining({ regla: "V6" }));
  });

  it("V7: rejects CS with a non-null cantidad", () => {
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "CS", cantidad: "5" })])])).toThrow(expect.objectContaining({ regla: "V7" }));
  });

  it("accepts CS with cantidad null", () => {
    expect(() => validarItemsReceta([item({}, [componente({ modoExpresion: "CS", cantidad: null })])])).not.toThrow();
  });
});

describe("validarItemsReceta -- V8 (fraccionDosisPorUnidad en (0,1])", () => {
  it("rejects 0", () => {
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "0" })])).toThrow(expect.objectContaining({ regla: "V8" }));
  });

  it("rejects > 1", () => {
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "1.5" })])).toThrow(expect.objectContaining({ regla: "V8" }));
  });

  it("accepts exactly 1 and 0.5", () => {
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "1" })])).not.toThrow();
    expect(() => validarItemsReceta([item({ fraccionDosisPorUnidad: "0.5" })])).not.toThrow();
  });
});

describe("validarItemsReceta -- V9 (cantidadUnidades entero > 0)", () => {
  it("rejects 0", () => {
    expect(() => validarItemsReceta([item({ cantidadUnidades: 0 })])).toThrow(expect.objectContaining({ regla: "V9" }));
  });

  it("rejects a non-integer", () => {
    expect(() => validarItemsReceta([item({ cantidadUnidades: 1.5 })])).toThrow(expect.objectContaining({ regla: "V9" }));
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
    expect(esEstadoTerminal("ENVIADA_PEND_FIRMA")).toBe(false);
  });

  it("puedeAnular is the negation of esEstadoTerminal (ANULADA reachable from any non-terminal state)", () => {
    expect(puedeAnular("PENDIENTE_PREPARACION")).toBe(true);
    expect(puedeAnular("PREPARADA")).toBe(true);
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

describe("validarOrigenHabilitado -- DP-29: DIGITAL_PDF enabled, DIGITAL_FOTO still out of scope", () => {
  it("PRESENCIAL and DIGITAL_PDF are the habilitados origenes", () => {
    expect(ORIGENES_HABILITADOS).toEqual(["PRESENCIAL", "DIGITAL_PDF"]);
  });

  it("does not throw for PRESENCIAL nor DIGITAL_PDF", () => {
    expect(() => validarOrigenHabilitado("PRESENCIAL")).not.toThrow();
    expect(() => validarOrigenHabilitado("DIGITAL_PDF")).not.toThrow();
  });

  it("rejects DIGITAL_FOTO with a ValidationError", () => {
    expect(() => validarOrigenHabilitado("DIGITAL_FOTO")).toThrow(ValidationError);
    expect(() => validarOrigenHabilitado("DIGITAL_FOTO")).toThrow(/foto/);
  });
});

describe("validarOrigenCargaManual -- digital recetas only come from the PDF import", () => {
  it("accepts a PRESENCIAL alta", () => {
    expect(() => validarOrigenCargaManual("PRESENCIAL", null)).not.toThrow();
  });

  it("rejects a DIGITAL_PDF alta by hand (it would have no emisor receta number)", () => {
    expect(() => validarOrigenCargaManual("DIGITAL_PDF", null)).toThrow(/importando su PDF/);
  });

  it("lets an edit keep the receta's own origen, including DIGITAL_PDF", () => {
    expect(() => validarOrigenCargaManual("DIGITAL_PDF", "DIGITAL_PDF")).not.toThrow();
    expect(() => validarOrigenCargaManual("PRESENCIAL", "PRESENCIAL")).not.toThrow();
  });

  it("rejects switching a digital receta to PRESENCIAL and a PRESENCIAL one to digital", () => {
    expect(() => validarOrigenCargaManual("PRESENCIAL", "DIGITAL_PDF")).toThrow(/no se puede cambiar/);
    expect(() => validarOrigenCargaManual("DIGITAL_PDF", "PRESENCIAL")).toThrow(ValidationError);
  });

  it("still rejects DIGITAL_FOTO first", () => {
    expect(() => validarOrigenCargaManual("DIGITAL_FOTO", null)).toThrow(/foto/);
  });
});

describe("diagnóstico CIE-10 (migration 0049's receta_diagnostico_codigo_check)", () => {
  it("accepts category and subcategory codes", () => {
    for (const codigo of ["E66", "E66.0", "J45.909", "U07.1"]) {
      expect(esDiagnosticoCodigoValido(codigo), codigo).toBe(true);
    }
  });

  it("rejects malformed codes", () => {
    for (const codigo of ["e66.0", "66.0", "E6", "E66.", "E66.00000", "E66-0"]) {
      expect(esDiagnosticoCodigoValido(codigo), codigo).toBe(false);
    }
  });

  it("the zod field normalizes case/spaces, maps empty to null and rejects an invalid code", () => {
    expect(diagnosticoCodigoOpcional.parse(" e66.0 ")).toBe("E66.0");
    expect(diagnosticoCodigoOpcional.parse("")).toBeNull();
    expect(diagnosticoCodigoOpcional.parse(undefined)).toBeNull();
    expect(diagnosticoCodigoOpcional.safeParse("obesidad").success).toBe(false);
  });
});

describe("duración del tratamiento", () => {
  it("the zod field maps absent to null and rejects non-positive or fractional days", () => {
    expect(duracionTratamientoDiasOpcional.parse(undefined)).toBeNull();
    expect(duracionTratamientoDiasOpcional.parse(null)).toBeNull();
    expect(duracionTratamientoDiasOpcional.parse(30)).toBe(30);
    expect(duracionTratamientoDiasOpcional.safeParse(0).success).toBe(false);
    expect(duracionTratamientoDiasOpcional.safeParse(1.5).success).toBe(false);
  });

  it("validarItemsReceta accepts posología/duración and rejects a non-positive duración", () => {
    expect(() => validarItemsReceta([item({ posologia: "Media dosis cada 12 horas", duracionTratamientoDias: 30 })])).not.toThrow();
    expect(() => validarItemsReceta([item({ duracionTratamientoDias: 0 })])).toThrow(/duración del tratamiento/);
  });
});
