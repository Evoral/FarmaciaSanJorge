/**
 * Unit tests for `modules/precios/domain/calcular-cotizacion.ts` (M10,
 * FASE 7 point 7.4, DP-09 RESUELTA). Pure function, no DB. Each test is
 * designed to FAIL without its guard -- see the task instruction this
 * module was built against.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { calcularCotizacion, calcularCotizacionesAcumuladas, mensajeSinCostoProveedor } from "@/modules/precios/domain/calcular-cotizacion";
import type { CostoProveedorCosteo, LineaCosteoInput, PartidaCosteo } from "@/modules/precios/domain/calcular-cotizacion";
import type { ReglasPrecio } from "@/modules/precios/domain/regla-precio";

const HOY = "2026-06-15";

/** One open-ended tramo, no floor: the pre-2026-10-01 single-margen behavior. */
function margenUnico(margen: string): ReglasPrecio {
  return { precioMinimo: "0", tramos: [{ costoHasta: null, margen }] };
}

/** The user's example rules (2026-10-01): <= 100000 -> +100%, > 100000 -> +70%, floor 20000. */
const REGLAS_EJEMPLO: ReglasPrecio = {
  precioMinimo: "20000",
  tramos: [
    { costoHasta: "100000", margen: "100" },
    { costoHasta: null, margen: "70" },
  ],
};

const GRAMO = { factorABase: "1", tipoMagnitud: "MASA" };
const MILIGRAMO = { factorABase: "0.001", tipoMagnitud: "MASA" };
const MILILITRO = { factorABase: "1", tipoMagnitud: "VOLUMEN" };

function costo(overrides: Partial<CostoProveedorCosteo> = {}): CostoProveedorCosteo {
  return {
    costoProveedorId: "cp-1",
    proveedorId: "prov-1",
    proveedorNombre: "Droguería Sur",
    precioInformado: "5000",
    unidadPrecioSimbolo: "kg",
    costoUnitario: "5",
    fechaPrecio: "2026-06-01",
    ...overrides,
  };
}

function linea(overrides: Partial<LineaCosteoInput> = {}): LineaCosteoInput {
  return {
    drogaId: "droga-1",
    drogaNombre: "Droga 1",
    unidadSimbolo: "g",
    unidad: GRAMO,
    unidadStock: GRAMO,
    cantidadAPesar: "10",
    esEnraseManual: false,
    orden: 0,
    costoProveedor: costo(),
    ...overrides,
  };
}

function partida(overrides: Partial<PartidaCosteo> = {}): PartidaCosteo {
  return {
    id: "P1",
    cantidadDisponible: "100",
    fechaVencimiento: "2026-12-31",
    fechaApertura: null,
    costoUnitario: "5",
    ...overrides,
  };
}

describe("calcularCotizacion", () => {
  it("costs a single non-manual linea fully covered by one partida, and adds the margen on top (DP-09)", () => {
    const lineas = [linea({ cantidadAPesar: "10" })];
    const partidas = { "droga-1": [partida({ costoUnitario: "5" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, margenUnico("200"));

    expect(resultado.costoInsumos.toString()).toBe("50"); // 10 * 5
    expect(resultado.margenAplicado.toString()).toBe("200");
    expect(resultado.precioFinal.toString()).toBe("150"); // 50 + 200% of 50
    expect(resultado.esParcial).toBe(false);
    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.detalle.lineas).toHaveLength(1);
    expect(resultado.detalle.lineas[0]!.fuente).toBe("PROVEEDOR");
    expect(resultado.detalle.lineas[0]!.partidas).toEqual([]);
    expect(resultado.detalle.lineas[0]!.subtotal).toBe("50");
  });

  it("margen 0: precioFinal equals costoInsumos -- selling at cost (DP-09)", () => {
    const lineas = [linea({ cantidadAPesar: "10" })];
    const partidas = { "droga-1": [partida({ costoUnitario: "5" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("50");
    expect(resultado.precioFinal.toString()).toBe("50");
  });

  it("a manual-enrase linea contributes ZERO to costoInsumos and marks the cotizacion esParcial -- never invents a quantity", () => {
    const lineas = [
      linea({ orden: 0, drogaId: "activo", cantidadAPesar: "3", costoProveedor: costo({ costoUnitario: "10" }) }),
      linea({ orden: 1, drogaId: "excipiente", cantidadAPesar: null, esEnraseManual: true, costoProveedor: null }),
    ];
    const partidas = { activo: [partida({ id: "PA", costoUnitario: "10" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, margenUnico("150"));

    expect(resultado.costoInsumos.toString()).toBe("30"); // only the active line: 3 * 10
    expect(resultado.esParcial).toBe(true);
    expect(resultado.esIncompleta).toBe(false);
    const manualDetalle = resultado.detalle.lineas.find((l) => l.drogaId === "excipiente")!;
    expect(manualDetalle.esEnraseManual).toBe(true);
    expect(manualDetalle.cantidadRequerida).toBeNull();
    expect(manualDetalle.subtotal).toBe("0");
    expect(manualDetalle.partidas).toEqual([]);
  });

  it("droga without costo de proveedor: no price (drogasSinPrecio, subtotal 0), faltante still reported from stock, esIncompleta false", () => {
    const lineas = [linea({ cantidadAPesar: "10", costoProveedor: null })];
    // Only 4 available, 10 requested.
    const partidas = { "droga-1": [partida({ id: "P1", cantidadDisponible: "4", costoUnitario: "5" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, margenUnico("100"));

    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.drogasSinPrecio).toEqual(["Droga 1"]);
    expect(resultado.costoInsumos.toString()).toBe("0");
    const detalle = resultado.detalle.lineas[0]!;
    expect(detalle.subtotal).toBe("0");
    expect(detalle.faltante).toBe("6");
    expect(detalle.partidas).toEqual([]);
    expect(detalle.fuente).toBeUndefined();
  });

  it("insufficient stock with ZERO eligible partidas and no costo de proveedor: no price, faltante = full requested quantity, esIncompleta false", () => {
    const lineas = [linea({ cantidadAPesar: "7", costoProveedor: null })];

    const resultado = calcularCotizacion(lineas, () => [], HOY, margenUnico("100"));

    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.drogasSinPrecio).toEqual(["Droga 1"]);
    expect(resultado.costoInsumos.toString()).toBe("0");
    expect(resultado.detalle.lineas[0]!.faltante).toBe("7");
    expect(resultado.detalle.lineas[0]!.partidas).toEqual([]);
    expect(resultado.detalle.lineas[0]!.subtotal).toBe("0");
  });

  it("expired partidas are never costed and excluded from eligible stock for faltante (INV-S10 eligibility)", () => {
    const lineas = [linea({ cantidadAPesar: "10", costoProveedor: costo({ costoUnitario: "9" }) })];
    const partidas = {
      "droga-1": [
        partida({ id: "VENCIDA", cantidadDisponible: "100", fechaVencimiento: "2026-01-01", costoUnitario: "1" }),
        partida({ id: "VIGENTE", cantidadDisponible: "4", fechaVencimiento: "2026-12-31", costoUnitario: "9" }),
      ],
    };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, margenUnico("100"));

    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.costoInsumos.toString()).toBe("90"); // 10 * 9
    expect(resultado.detalle.lineas[0]!.partidas).toEqual([]);
    expect(resultado.detalle.lineas[0]!.faltante).toBe("6"); // 10 - 4 eligible (expired 100 ignored)
  });

  it("open partida consumed first, then FEFO for the rest in stock simulation", () => {
    const lineas1 = [linea({ cantidadAPesar: "10", costoProveedor: costo({ costoUnitario: "2" }) })];
    const lineas2 = [linea({ cantidadAPesar: "10", costoProveedor: costo({ costoUnitario: "2" }) })];
    const partidas = [
      partida({ id: "ABIERTA", cantidadDisponible: "5", fechaVencimiento: "2027-01-01", fechaApertura: "2026-06-01T10:00:00Z" }),
      partida({ id: "CERRADA_TEMPRANA", cantidadDisponible: "10", fechaVencimiento: "2026-07-01" }),
      partida({ id: "CERRADA_TARDIA", cantidadDisponible: "10", fechaVencimiento: "2026-08-01" }),
    ];

    const [primero, segundo] = calcularCotizacionesAcumuladas([lineas1, lineas2], () => partidas, HOY, margenUnico("0"));

    // Both items cost $20 from costoProveedor
    expect(primero!.costoInsumos.toString()).toBe("20");
    expect(segundo!.costoInsumos.toString()).toBe("20");
    expect(primero!.detalle.lineas[0]!.faltante).toBeNull();
    expect(segundo!.detalle.lineas[0]!.faltante).toBeNull();
    expect(primero!.detalle.lineas[0]!.partidas).toEqual([]);
    expect(segundo!.detalle.lineas[0]!.partidas).toEqual([]);
  });

  it("multiple drogas: costoInsumos is the sum across every linea's own subtotal", () => {
    const lineas = [
      linea({ orden: 0, drogaId: "a", drogaNombre: "a", cantidadAPesar: "2", costoProveedor: costo({ costoUnitario: "10" }) }),
      linea({ orden: 1, drogaId: "b", drogaNombre: "b", cantidadAPesar: "3", costoProveedor: costo({ costoUnitario: "100" }) }),
    ];
    const partidas = {
      a: [partida({ id: "PA", costoUnitario: "10" })],
      b: [partida({ id: "PB", costoUnitario: "100" })],
    };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, margenUnico("100"));

    expect(resultado.costoInsumos.toString()).toBe("320"); // (2*10) + (3*100)
    expect(resultado.precioFinal.toString()).toBe("640");
    expect(resultado.esIncompleta).toBe(false);
  });

  it("uses Decimal precision throughout -- never float (INV-PL-003)", () => {
    const lineas = [linea({ cantidadAPesar: "0.1", costoProveedor: costo({ costoUnitario: "0.2" }) })];
    const partidas = { "droga-1": [partida({ costoUnitario: "0.2" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, margenUnico("100"));

    // 0.1 * 0.2 = 0.02 exactly under Decimal; float arithmetic would give 0.020000000000000004.
    expect(resultado.costoInsumos.equals(new Decimal("0.02"))).toBe(true);
    expect(resultado.costoInsumos.toString()).toBe("0.02");
  });
});

describe("calcularCotizacion -- price rules by tramo + floor (2026-10-01)", () => {
  const costoFixture = (total: string) => ({
    lineas: [linea({ cantidadAPesar: total, costoProveedor: costo({ costoUnitario: "1" }) })],
    partidas: [partida({ costoUnitario: "1", cantidadDisponible: "1000000" })],
  });

  it("records the tramo markup actually used and the tramo index", () => {
    const { lineas, partidas } = costoFixture("100001");
    const resultado = calcularCotizacion(lineas, () => partidas, HOY, REGLAS_EJEMPLO);
    expect(resultado.costoInsumos.toString()).toBe("100001");
    expect(resultado.margenAplicado.toString()).toBe("70");
    expect(resultado.tramoAplicado).toBe(1);
    expect(resultado.precioMinimoAplicado).toBe(false);
    expect(resultado.precioFinal.toString()).toBe("170001.7");
  });

  it("flags the floor when it raised the price, keeping the tramo markup as margenAplicado", () => {
    const { lineas, partidas } = costoFixture("5000");
    const resultado = calcularCotizacion(lineas, () => partidas, HOY, REGLAS_EJEMPLO);
    expect(resultado.margenAplicado.toString()).toBe("100");
    expect(resultado.precioMinimoAplicado).toBe(true);
    expect(resultado.precioFinal.toString()).toBe("20000");
  });

  it("calcularCotizacionesAcumuladas prices EACH item on its own cost (never on the receta's total)", () => {
    const lineas = [linea({ cantidadAPesar: "60000", costoProveedor: costo({ costoUnitario: "1" }) })];
    const partidas = [partida({ costoUnitario: "1", cantidadDisponible: "1000000" })];
    const [primero, segundo] = calcularCotizacionesAcumuladas([lineas, lineas], () => partidas, HOY, REGLAS_EJEMPLO);
    // 60000 + 60000 = 120000 would fall in the 70% tramo; each item alone is in the 100% tramo.
    expect(primero!.precioFinal.toString()).toBe("120000");
    expect(segundo!.precioFinal.toString()).toBe("120000");
    expect(segundo!.margenAplicado.toString()).toBe("100");
  });
});

describe("calcularCotizacion -- units: línea in its magnitud's base, stock in the droga's unidad base", () => {
  it("converts a línea in g into a droga kept in mg before splitting and costing (950 g -> 950000 mg)", () => {
    const lineas = [linea({ cantidadAPesar: "950", unidad: GRAMO, unidadStock: MILIGRAMO, costoProveedor: costo({ costoUnitario: "0.01" }) })];
    // costoUnitario is per mg (the droga's unidad base).
    const partidas = [partida({ id: "P1", cantidadDisponible: "1000000", costoUnitario: "0.01" })];

    const resultado = calcularCotizacion(lineas, () => partidas, HOY, margenUnico("0"));

    expect(resultado.detalle.lineas[0]!.partidas).toEqual([]);
    expect(resultado.detalle.lineas[0]!.cantidadRequerida).toBe("950");
    expect(resultado.costoInsumos.toString()).toBe("9500");
    expect(resultado.esIncompleta).toBe(false);
  });

  it("reports the faltante back in the línea's unit", () => {
    const lineas = [linea({ cantidadAPesar: "950", unidad: GRAMO, unidadStock: MILIGRAMO, costoProveedor: costo({ costoUnitario: "0.01" }) })];
    const partidas = [partida({ id: "P1", cantidadDisponible: "500000", costoUnitario: "0.01" })];

    const resultado = calcularCotizacion(lineas, () => partidas, HOY, margenUnico("0"));

    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.detalle.lineas[0]!.faltante).toBe("450"); // g
    expect(resultado.detalle.lineas[0]!.partidas).toEqual([]);
    expect(resultado.costoInsumos.toString()).toBe("9500");
  });

  it("calcularCotizacionesAcumuladas subtracts what each item used in the droga's unidad base", () => {
    const lineas = [linea({ cantidadAPesar: "600", unidad: GRAMO, unidadStock: MILIGRAMO, costoProveedor: costo({ costoUnitario: "0.01" }) })];
    const partidas = [partida({ id: "P1", cantidadDisponible: "1000000", costoUnitario: "0.01" })];

    const [primero, segundo] = calcularCotizacionesAcumuladas([lineas, lineas], () => partidas, HOY, margenUnico("0"));

    expect(primero!.esIncompleta).toBe(false);
    expect(segundo!.esIncompleta).toBe(false);
    expect(segundo!.detalle.lineas[0]!.faltante).toBe("200"); // 1200 g needed, 1000 g in stock
  });

  it("a línea that can not be converted (different magnitud) is not costed: 0, esParcial, no invented faltante", () => {
    const lineas = [linea({ cantidadAPesar: "10", unidad: MILILITRO, unidadStock: GRAMO, costoProveedor: costo() })];
    const partidas = [partida({ id: "P1", cantidadDisponible: "1000", costoUnitario: "5" })];

    const resultado = calcularCotizacion(lineas, () => partidas, HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("0");
    expect(resultado.esParcial).toBe(true);
    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.detalle.lineas[0]!.partidas).toEqual([]);
  });
});

describe("mensajeSinCostoProveedor", () => {
  it("formats singular message for one droga without price", () => {
    expect(mensajeSinCostoProveedor(["Urea"])).toBe("No se puede dar el precio: Urea no tiene precio cargado en costos de proveedor.");
  });

  it("formats plural message with joined names for several drogas without price", () => {
    expect(mensajeSinCostoProveedor(["Urea", "Mazindol"])).toBe("No se puede dar el precio: Urea, Mazindol no tienen precio cargado en costos de proveedor.");
  });
});
