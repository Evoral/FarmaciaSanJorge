/**
 * Pure domain of the "Comparador de costos" (docs/specs/comparador-costos.md):
 * filter parsing, display-unit conversion, ranking, difference, weighted
 * average, outliers, "antiguo" and the assembly of the comparison. No DB.
 */
import { describe, it, expect } from "vitest";
import type { UnidadFormato } from "@/shared/format/cantidad";
import {
  PARTIDAS_DETALLE_MAX,
  armarComparacion,
  convertirCosto,
  diferenciaContraMinimo,
  esCompraAntigua,
  esCostoAtipico,
  etiquetaOpcionDroga,
  inicioPeriodo,
  limitesAtipicos,
  opcionesUnidadCosto,
  ordenarOpcionesDroga,
  parsearFiltrosComparador,
  porcentajeBarra,
  promedioPonderado,
  resolverUnidadCosto,
  restarMeses,
  unidadPredeterminada,
  unidadesConvertiblesDe,
} from "@/modules/proveedores/domain/comparador-costos";
import type { AgregadoProveedorCrudo, ComparacionCruda, PartidaComparadorCruda } from "@/modules/proveedores/domain/comparador-costos";

const U = (id: string, codigo: string, simbolo: string, tipoMagnitud: string, factorABase: string, esBase = false, vigente = true): UnidadFormato => ({
  id,
  codigo,
  simbolo,
  tipoMagnitud,
  factorABase,
  esBase,
  vigente,
});

const MCG = U("u-mcg", "MICROGRAMO", "mcg", "MASA", "0.000001");
const MG = U("u-mg", "MILIGRAMO", "mg", "MASA", "0.001");
const G = U("u-g", "GRAMO", "g", "MASA", "1", true);
const KG = U("u-kg", "KILOGRAMO", "kg", "MASA", "1000");
const MCL = U("u-mcl", "MICROLITRO", "mcL", "VOLUMEN", "0.001");
const ML = U("u-ml", "MILILITRO", "mL", "VOLUMEN", "1", true);
const L = U("u-l", "LITRO", "L", "VOLUMEN", "1000");
const UNIDAD = U("u-un", "UNIDAD", "u", "UNIDADES", "1", true);
const CATALOGO = [MCG, MG, G, KG, MCL, ML, L, UNIDAD];

const DROGA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("parsearFiltrosComparador", () => {
  it("accepts a uuid droga, a unit code and a known periodo", () => {
    expect(parsearFiltrosComparador({ droga: DROGA_ID, unidad: "GRAMO", periodo: "todo" })).toEqual({ drogaId: DROGA_ID, drogaInvalida: false, unidad: "GRAMO", periodo: "todo" });
  });

  it("defaults: no droga, no unit, periodo 12m", () => {
    expect(parsearFiltrosComparador({})).toEqual({ drogaId: null, drogaInvalida: false, unidad: null, periodo: "12m" });
  });

  it("rejects a malformed droga instead of passing it on", () => {
    for (const droga of ["", "abc", "1; DROP TABLE fsj.partida", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa", " "]) {
      expect(parsearFiltrosComparador({ droga }).drogaId, droga).toBeNull();
    }
  });

  it("tells a present-but-invalid droga (garbage) apart from no droga at all", () => {
    expect(parsearFiltrosComparador({ droga: "abc" }).drogaInvalida).toBe(true);
    expect(parsearFiltrosComparador({ droga: ["abc", DROGA_ID] }).drogaInvalida).toBe(true);
    for (const droga of [undefined, "", "   "]) expect(parsearFiltrosComparador({ droga }).drogaInvalida, String(droga)).toBe(false);
    expect(parsearFiltrosComparador({ droga: DROGA_ID }).drogaInvalida).toBe(false);
  });

  it("keeps the first value of a repeated param", () => {
    expect(parsearFiltrosComparador({ droga: [DROGA_ID, "otra"], unidad: ["miligramo", "GRAMO"], periodo: ["todo", "12m"] })).toEqual({
      drogaId: DROGA_ID,
      drogaInvalida: false,
      unidad: "MILIGRAMO",
      periodo: "todo",
    });
  });

  it("normalizes the unit: base in lowercase, codes in uppercase, anything else is dropped", () => {
    expect(parsearFiltrosComparador({ unidad: "BASE" }).unidad).toBe("base");
    expect(parsearFiltrosComparador({ unidad: "gramo" }).unidad).toBe("GRAMO");
    for (const unidad of ["g r", "1g", "mg;", "'", "A".repeat(33), ""]) {
      expect(parsearFiltrosComparador({ unidad }).unidad, unidad).toBeNull();
    }
  });

  it("falls back to 12m for an unknown periodo", () => {
    for (const periodo of ["", "24m", "TODO", "all"]) expect(parsearFiltrosComparador({ periodo }).periodo, periodo).toBe("12m");
    expect(parsearFiltrosComparador({ periodo: "12m" }).periodo).toBe("12m");
  });
});

describe("droga options", () => {
  const fecha = new Date("2026-01-01T00:00:00Z");
  it("lists vigentes first, then the ones de baja, each group by name", () => {
    const opciones = ordenarOpcionesDroga([
      { id: "3", nombre: "Zinc", fechaBaja: null },
      { id: "2", nombre: "Ácido bórico", fechaBaja: fecha },
      { id: "1", nombre: "Minoxidil", fechaBaja: null },
      { id: "4", nombre: "Alcohol", fechaBaja: fecha },
    ]);
    expect(opciones.map((o) => o.nombre)).toEqual(["Minoxidil", "Zinc", "Ácido bórico", "Alcohol"]);
    expect(opciones.map((o) => o.deBaja)).toEqual([false, false, true, true]);
  });

  it("marks the baja ones in the option text", () => {
    expect(etiquetaOpcionDroga({ id: "1", nombre: "Zinc", deBaja: false })).toBe("Zinc");
    expect(etiquetaOpcionDroga({ id: "1", nombre: "Zinc", deBaja: true })).toBe("Zinc (de baja)");
  });
});

describe("display unit: options and default", () => {
  it("offers the whole convertible chain of the magnitude, smallest first, with the base marked", () => {
    const opciones = opcionesUnidadCosto(MG, CATALOGO);
    expect(opciones.map((o) => o.unidad.codigo)).toEqual(["MICROGRAMO", "MILIGRAMO", "GRAMO", "KILOGRAMO"]);
    expect(opciones.map((o) => o.valor)).toEqual(["MICROGRAMO", "base", "GRAMO", "KILOGRAMO"]);
    expect(opciones.find((o) => o.valor === "base")!.etiqueta).toBe("mg (unidad base)");
    expect(opciones.find((o) => o.valor === "GRAMO")!.etiqueta).toBe("g");
  });

  it("does not mix magnitudes: a volumen droga never offers masa units", () => {
    expect(unidadesConvertiblesDe(ML, CATALOGO).map((u) => u.codigo)).toEqual(["MICROLITRO", "MILILITRO", "LITRO"]);
  });

  it("a non-convertible base (UNIDAD, ...) only offers itself", () => {
    expect(unidadesConvertiblesDe(UNIDAD, CATALOGO)).toEqual([UNIDAD]);
    const rara = U("u-x", "GOTA", "gt", "MASA", "0.05", true); // same magnitude as masa but not whitelisted
    expect(unidadesConvertiblesDe(rara, [...CATALOGO, rara])).toEqual([rara]);
  });

  it("leaves out units dadas de baja, but never the droga's own base", () => {
    const kgBaja = { ...KG, vigente: false };
    expect(unidadesConvertiblesDe(MG, [MCG, MG, G, kgBaja]).map((u) => u.codigo)).toEqual(["MICROGRAMO", "MILIGRAMO", "GRAMO"]);
    const mgBaja = { ...MG, vigente: false };
    expect(unidadesConvertiblesDe(mgBaja, [MCG, mgBaja, G]).map((u) => u.codigo)).toEqual(["MICROGRAMO", "MILIGRAMO", "GRAMO"]);
  });

  it("still works with a catalog that lacks the base row", () => {
    expect(unidadesConvertiblesDe(MG, [G]).map((u) => u.codigo)).toEqual(["MILIGRAMO", "GRAMO"]);
  });

  it("defaults: mg and mcg -> g, mcL -> mL, any other base stays", () => {
    const por = (base: UnidadFormato) => unidadPredeterminada(base, opcionesUnidadCosto(base, CATALOGO)).unidad.codigo;
    expect(por(MG)).toBe("GRAMO");
    expect(por(MCG)).toBe("GRAMO");
    expect(por(MCL)).toBe("MILILITRO");
    expect(por(G)).toBe("GRAMO");
    expect(por(KG)).toBe("KILOGRAMO");
    expect(por(ML)).toBe("MILILITRO");
    expect(por(L)).toBe("LITRO");
    expect(por(UNIDAD)).toBe("UNIDAD");
  });

  it("falls back to the base when the practical unit is not in the catalog", () => {
    const sinGramo = [MCG, MG];
    expect(unidadPredeterminada(MG, opcionesUnidadCosto(MG, sinGramo)).unidad.codigo).toBe("MILIGRAMO");
  });

  it("resolves the requested unit: base, a codigo (any case), and falls back to the default for anything else", () => {
    expect(resolverUnidadCosto(MG, CATALOGO, null).seleccionada.unidad.codigo).toBe("GRAMO");
    expect(resolverUnidadCosto(MG, CATALOGO, "base").seleccionada.unidad.codigo).toBe("MILIGRAMO");
    // a carried-over "base" is simply the base of the NEW droga
    expect(resolverUnidadCosto(ML, CATALOGO, "base").seleccionada.unidad.codigo).toBe("MILILITRO");
    expect(resolverUnidadCosto(UNIDAD, CATALOGO, "base").seleccionada.unidad.codigo).toBe("UNIDAD");
    expect(resolverUnidadCosto(MG, CATALOGO, "MILIGRAMO").seleccionada.unidad.codigo).toBe("MILIGRAMO");
    expect(resolverUnidadCosto(MG, CATALOGO, "kilogramo").seleccionada.unidad.codigo).toBe("KILOGRAMO");
    expect(resolverUnidadCosto(MG, CATALOGO, "LITRO").seleccionada.unidad.codigo).toBe("GRAMO"); // other magnitude
    expect(resolverUnidadCosto(MG, CATALOGO, "NOEXISTE").seleccionada.unidad.codigo).toBe("GRAMO");
    expect(resolverUnidadCosto(UNIDAD, CATALOGO, "GRAMO").seleccionada.unidad.codigo).toBe("UNIDAD");
    expect(resolverUnidadCosto(MG, CATALOGO, "GRAMO").opciones).toHaveLength(4);
  });
});

describe("convertirCosto (Decimal, costoBase x factorDestino / factorOrigen)", () => {
  it("a cost per mg expressed per g is 1000x", () => {
    expect(convertirCosto("2", MG, G).toFixed()).toBe("2000");
    expect(convertirCosto("0.0035", MG, G).toFixed()).toBe("3.5");
  });

  it("a cost per g expressed per mg is 1/1000", () => {
    expect(convertirCosto("2000", G, MG).toFixed()).toBe("2");
    expect(convertirCosto("2", G, MG).toFixed()).toBe("0.002");
  });

  it("goes through the whole chain, both ways", () => {
    expect(convertirCosto("0.002", MG, KG).toFixed()).toBe("2000");
    expect(convertirCosto("2000", KG, MG).toFixed()).toBe("0.002");
    expect(convertirCosto("1", MCG, KG).toFixed()).toBe("1000000000");
    expect(convertirCosto("3", ML, L).toFixed()).toBe("3000");
    expect(convertirCosto("3", MCL, ML).toFixed()).toBe("3000");
  });

  it("the same unit is the identity", () => {
    expect(convertirCosto("12.345678", G, G).toFixed()).toBe("12.345678");
  });

  it("is exact where an IEEE-754 float is not (INV-PL-003)", () => {
    // 0.1 + 0.2 !== 0.3 in floats; a cost of 0.0003 per mg is exactly 0.3 per g.
    expect(convertirCosto("0.0003", MG, G).toFixed()).toBe("0.3");
    expect(convertirCosto("0.0001", MG, G).plus(convertirCosto("0.0002", MG, G)).toFixed()).toBe("0.3");
  });

  it("refuses a unit without a positive factor", () => {
    expect(() => convertirCosto("1", { ...G, factorABase: "0" }, MG)).toThrow(/factor_a_base/);
  });
});

describe("period and antiguo (tenant zone aware)", () => {
  it("subtracts calendar months, clamping the day", () => {
    expect(restarMeses("2026-10-01", 12)).toBe("2025-10-01");
    expect(restarMeses("2026-03-31", 1)).toBe("2026-02-28");
    expect(restarMeses("2024-03-31", 1)).toBe("2024-02-29");
    expect(restarMeses("2024-02-29", 12)).toBe("2023-02-28");
    expect(restarMeses("2026-01-15", 2)).toBe("2025-11-15");
    expect(restarMeses("2026-01-15", 13)).toBe("2024-12-15");
  });

  it("`todo` has no start; `12m` starts at local midnight of the jornada 12 months back", () => {
    expect(inicioPeriodo("todo", "2026-10-01", "America/Argentina/Mendoza")).toBeNull();
    // Mendoza is UTC-3 all year: local midnight is 03:00Z.
    expect(inicioPeriodo("12m", "2026-10-01", "America/Argentina/Mendoza")!.toISOString()).toBe("2025-10-01T03:00:00.000Z");
    expect(inicioPeriodo("12m", "2026-10-01", "UTC")!.toISOString()).toBe("2025-10-01T00:00:00.000Z");
  });

  it("flags a purchase older than 12 months by the tenant's calendar day, not the UTC one", () => {
    const zona = "America/Argentina/Mendoza";
    const jornada = "2026-10-01";
    // 2025-10-01T01:00Z is still 2025-09-30 22:00 in Mendoza: older than 12 months there, not in UTC.
    expect(esCompraAntigua(new Date("2025-10-01T01:00:00Z"), jornada, zona)).toBe(true);
    expect(esCompraAntigua(new Date("2025-10-01T01:00:00Z"), jornada, "UTC")).toBe(false);
    // Local midnight of the boundary day is NOT antiguo (exactly 12 months).
    expect(esCompraAntigua(new Date("2025-10-01T03:00:00Z"), jornada, zona)).toBe(false);
    expect(esCompraAntigua(new Date("2026-09-30T12:00:00Z"), jornada, zona)).toBe(false);
    expect(esCompraAntigua(new Date("2024-01-01T12:00:00Z"), jornada, zona)).toBe(true);
  });
});

describe("outliers (>= 3 partidas, x10 / x0.1 of the median)", () => {
  it("builds the band only with at least 3 partidas and a positive median", () => {
    expect(limitesAtipicos("10", 3)).toEqual({ minimo: "1", maximo: "100" });
    expect(limitesAtipicos("10", 2)).toBeNull();
    expect(limitesAtipicos("10", 0)).toBeNull();
    expect(limitesAtipicos(null, 5)).toBeNull();
    expect(limitesAtipicos("0", 5)).toBeNull();
    expect(limitesAtipicos("-4", 5)).toBeNull();
  });

  it("keeps the band exact with decimals", () => {
    expect(limitesAtipicos("0.0035", 4)).toEqual({ minimo: "0.00035", maximo: "0.035" });
  });

  it("flags strictly outside the band: > 10x or < 0.1x; the edges are not outliers", () => {
    const limites = limitesAtipicos("10", 5);
    expect(esCostoAtipico("100.01", limites)).toBe(true);
    expect(esCostoAtipico("100", limites)).toBe(false);
    expect(esCostoAtipico("10", limites)).toBe(false);
    expect(esCostoAtipico("1", limites)).toBe(false);
    expect(esCostoAtipico("0.99", limites)).toBe(true);
  });

  it("never flags cost 0 (it is excluded instead), nor anything without a band", () => {
    expect(esCostoAtipico("0", limitesAtipicos("10", 5))).toBe(false);
    expect(esCostoAtipico("1000000", null)).toBe(false);
  });

  it("a wrong-unit cost (the '1.500' parsed as 1.5 trap, or a per-g cost typed per mg) is caught", () => {
    const limites = limitesAtipicos("1500", 6); // median cost of the droga: $ 1.500 per unit
    expect(esCostoAtipico("1.5", limites)).toBe(true);
    expect(esCostoAtipico("1500000", limites)).toBe(true);
    expect(esCostoAtipico("1700", limites)).toBe(false);
  });
});

describe("weighted average", () => {
  it("is sum(cantidad x costo) / sum(cantidad)", () => {
    expect(promedioPonderado("300", "30")!.toFixed()).toBe("10");
  });

  it("is exact where floats are not", () => {
    // 3 at 0.1 and 7 at 0.2 -> 1.7 / 10 = 0.17 (floats give 0.16999999999999998)
    expect(promedioPonderado("1.7", "10")!.toFixed()).toBe("0.17");
  });

  it("has no average without quantity", () => {
    expect(promedioPonderado("0", "0")).toBeNull();
    expect(promedioPonderado("5", "-1")).toBeNull();
  });
});

describe("difference against the cheapest and the ranking bar", () => {
  it("computes the amount and the percentage with Decimal", () => {
    expect(diferenciaContraMinimo("12.5", "10")).toEqual({ monto: "2.5", porcentaje: "25" });
    expect(diferenciaContraMinimo("10", "10")).toEqual({ monto: "0", porcentaje: "0" });
    expect(diferenciaContraMinimo("11", "30")).toEqual({ monto: "-19", porcentaje: "-63.33" });
    expect(diferenciaContraMinimo("0.3", "0.1")).toEqual({ monto: "0.2", porcentaje: "200" });
  });

  it("has no percentage against a non-positive minimum", () => {
    expect(diferenciaContraMinimo("5", "0")).toBeNull();
  });

  it("draws the bar relative to the largest cost, between 2 and 100", () => {
    expect(porcentajeBarra("12.5", "12.5")).toBe("100");
    expect(porcentajeBarra("10", "12.5")).toBe("80");
    expect(porcentajeBarra("1", "3")).toBe("33.3");
    expect(porcentajeBarra("0.0001", "100")).toBe("2");
    expect(porcentajeBarra("0", "10")).toBe("0");
    expect(porcentajeBarra("5", "0")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// armarComparacion
// ---------------------------------------------------------------------------

function agregado(over: Partial<AgregadoProveedorCrudo> & { proveedorId: string; razonSocial: string }): AgregadoProveedorCrudo {
  return {
    fechaBaja: null,
    partidasTotal: 1,
    partidasConCosto: 1,
    partidasCostoCero: 0,
    partidasAtipicas: 0,
    cantidadConCosto: "1000",
    importeConCosto: "10",
    costoMin: "0.01",
    costoMax: "0.01",
    ultimoCosto: "0.01",
    ultimaCompra: new Date("2026-09-15T12:00:00Z"),
    ...over,
  };
}

function cruda(over: Partial<ComparacionCruda> = {}): ComparacionCruda {
  return {
    droga: { id: DROGA_ID, nombre: "Minoxidil", deBaja: false },
    unidadBase: MG,
    unidadesCatalogo: CATALOGO.filter((u) => u.tipoMagnitud === "MASA"),
    periodo: "12m",
    jornada: "2026-10-01",
    zonaHoraria: "America/Argentina/Mendoza",
    inicio: new Date("2025-10-01T03:00:00Z"),
    limites: null,
    partidasConCosto: 0,
    agregados: [],
    partidas: [],
    ...over,
  };
}

// Costs are per mg; the default display unit for a mg droga is g (x1000).
const A = agregado({ proveedorId: "pa", razonSocial: "Droguería A", ultimoCosto: "0.01", costoMin: "0.009", costoMax: "0.011", cantidadConCosto: "3000", importeConCosto: "30" });
const B = agregado({ proveedorId: "pb", razonSocial: "Droguería B", ultimoCosto: "0.0125", costoMin: "0.0125", costoMax: "0.0125", cantidadConCosto: "2000", importeConCosto: "25" });
const C = agregado({
  proveedorId: "pc",
  razonSocial: "Droguería C",
  ultimoCosto: null,
  ultimaCompra: null,
  costoMin: null,
  costoMax: null,
  partidasTotal: 2,
  partidasConCosto: 0,
  partidasCostoCero: 2,
  cantidadConCosto: "0",
  importeConCosto: "0",
});
const D = agregado({ proveedorId: "pd", razonSocial: "Droguería D (baja)", fechaBaja: new Date("2026-01-01T00:00:00Z"), ultimoCosto: "0.008", costoMin: "0.008", costoMax: "0.008" });

describe("armarComparacion -- ranking, differences and badges", () => {
  const comparacion = armarComparacion(cruda({ agregados: [D, C, B, A] }), null);
  const fila = (id: string) => comparacion.proveedores.find((f) => f.proveedorId === id)!;

  it("orders vigentes by ascending último costo, then the ones without cost, then the baja proveedores last", () => {
    expect(comparacion.proveedores.map((f) => f.proveedorId)).toEqual(["pa", "pb", "pc", "pd"]);
  });

  it("shows costs per the default display unit (g) converted from the base (mg)", () => {
    expect(comparacion.unidadMostrada.codigo).toBe("GRAMO");
    expect(comparacion.convertida).toBe(true);
    expect(comparacion.unidadSeleccionada).toBe("GRAMO");
    expect(fila("pa")).toMatchObject({ ultimoCosto: "10", costoMin: "9", costoMax: "11", promedioPonderado: "10" });
    expect(fila("pb")).toMatchObject({ ultimoCosto: "12.5", promedioPonderado: "12.5" });
  });

  it("'Más barato' is the lowest último costo among VIGENTES: a cheaper baja proveedor does not take it", () => {
    expect(fila("pa").esMasBarato).toBe(true);
    expect(fila("pb").esMasBarato).toBe(false);
    expect(fila("pd").esMasBarato).toBe(false);
    expect(fila("pd").deBaja).toBe(true);
  });

  it("difference vs. the cheapest: amount and percentage; none for the cheapest, a baja proveedor or a row without cost", () => {
    expect(fila("pa").diferencia).toBeNull();
    expect(fila("pb").diferencia).toEqual({ monto: "2.5", porcentaje: "25" });
    expect(fila("pc").diferencia).toBeNull();
    expect(fila("pd").diferencia).toBeNull();
  });

  it("a row without any costed partida has no costs but is still listed", () => {
    expect(fila("pc")).toMatchObject({ ultimoCosto: null, ultimaCompra: null, barraPorcentaje: null, promedioPonderado: null, costoMin: null, costoMax: null, esAntiguo: false });
  });

  it("bars are proportional to the largest vigente último costo (a baja row below it does not change the scale)", () => {
    expect(fila("pb").barraPorcentaje).toBe("100");
    expect(fila("pa").barraPorcentaje).toBe("80");
    expect(fila("pd").barraPorcentaje).toBe("64");
  });

  it("counts the cost-0 partidas of every proveedor", () => {
    expect(comparacion.partidasCostoCero).toBe(2);
    expect(fila("pc").partidasCostoCero).toBe(2);
  });

  it("is not a single-proveedor comparison", () => {
    expect(comparacion.sinOtrosProveedores).toBe(false);
  });

  it("a tie for the lowest cost gives the badge to every tied vigente proveedor, with no difference", () => {
    const empate = armarComparacion(cruda({ agregados: [A, agregado({ proveedorId: "pz", razonSocial: "Zeta", ultimoCosto: "0.01" }), B] }), null);
    expect(empate.proveedores.map((f) => [f.proveedorId, f.esMasBarato, f.diferencia?.monto ?? null])).toEqual([
      ["pa", true, null],
      ["pz", true, null],
      ["pb", false, "2.5"],
    ]);
  });

  it("ties are broken by razón social, then id, so the order is stable", () => {
    const r = armarComparacion(cruda({ agregados: [agregado({ proveedorId: "p2", razonSocial: "Beta" }), agregado({ proveedorId: "p1", razonSocial: "Alfa" })] }), null);
    expect(r.proveedores.map((f) => f.razonSocial)).toEqual(["Alfa", "Beta"]);
  });

  it("only baja proveedores: nobody is 'más barato' and nobody has a difference", () => {
    const r = armarComparacion(cruda({ agregados: [D, agregado({ proveedorId: "pe", razonSocial: "E", fechaBaja: new Date("2026-02-01T00:00:00Z"), ultimoCosto: "0.02" })] }), null);
    expect(r.proveedores.every((f) => !f.esMasBarato && f.diferencia === null && f.deBaja)).toBe(true);
  });

  it("a single proveedor: normal row, no 'más barato', and the single-proveedor notice", () => {
    const r = armarComparacion(cruda({ agregados: [A] }), null);
    expect(r.sinOtrosProveedores).toBe(true);
    expect(r.proveedores[0]).toMatchObject({ esMasBarato: false, diferencia: null, ultimoCosto: "10" });
  });

  it("one vigente proveedor with cost plus one WITHOUT cost, or plus a baja one: still nothing to compare, no badge", () => {
    for (const otro of [C, D]) {
      const r = armarComparacion(cruda({ agregados: [A, otro] }), null);
      expect(r.sinOtrosProveedores, otro.razonSocial).toBe(true);
      expect(r.proveedores.every((f) => !f.esMasBarato && f.diferencia === null), otro.razonSocial).toBe(true);
    }
  });

  it("two vigentes with cost: comparable (no notice)", () => {
    expect(armarComparacion(cruda({ agregados: [A, B] }), null).sinOtrosProveedores).toBe(false);
  });

  it("no proveedores in the period: an empty comparison", () => {
    const r = armarComparacion(cruda(), null);
    expect(r.proveedores).toEqual([]);
    expect(r.sinOtrosProveedores).toBe(false); // no rows: the empty state speaks, not the notice
    expect(r.partidasCostoCero).toBe(0);
  });
});

describe("armarComparacion -- outliers do not rank, bars ignore them", () => {
  // Band of a droga whose median is 0.01 per mg: costs under 0.001 or over 0.1 are outliers.
  const limites = limitesAtipicos("0.01", 5);
  const bajoAtipico = agregado({ proveedorId: "px", razonSocial: "Barato falso", ultimoCosto: "0.00005", costoMin: "0.00005", costoMax: "0.00005", partidasAtipicas: 1 });
  const altoAtipico = agregado({ proveedorId: "py", razonSocial: "Caro falso", ultimoCosto: "5", costoMin: "5", costoMax: "5", partidasAtipicas: 1 });
  const fila = (r: ReturnType<typeof armarComparacion>, id: string) => r.proveedores.find((f) => f.proveedorId === id)!;
  const baja = (id: string, ultimoCosto: string) => agregado({ proveedorId: id, razonSocial: `Baja ${id}`, fechaBaja: new Date("2026-01-01T00:00:00Z"), ultimoCosto });

  it("a too-cheap outlier does not win 'Más barato' nor set the minimum of the difference column", () => {
    const r = armarComparacion(cruda({ limites, agregados: [bajoAtipico, A, B] }), null);
    expect(fila(r, "px")).toMatchObject({ ultimoAtipico: true, esMasBarato: false, diferencia: null, revisar: true });
    expect(fila(r, "pa")).toMatchObject({ esMasBarato: true, diferencia: null, ultimoAtipico: false });
    expect(fila(r, "pb").diferencia).toEqual({ monto: "2.5", porcentaje: "25" }); // against A (10), not the outlier (0.05)
  });

  it("a too-expensive outlier is flagged, gets a difference against the real minimum, and does not take the badge", () => {
    const r = armarComparacion(cruda({ limites, agregados: [A, B, altoAtipico] }), null);
    expect(fila(r, "py")).toMatchObject({ ultimoAtipico: true, esMasBarato: false, ultimoCosto: "5000" });
    expect(fila(r, "py").diferencia!.monto).toBe("4990");
    expect(fila(r, "pa").esMasBarato).toBe(true);
  });

  it("without an outlier band nothing is an outlier (the cheapest wins, whatever it costs)", () => {
    const r = armarComparacion(cruda({ limites: null, agregados: [bajoAtipico, A] }), null);
    expect(fila(r, "px")).toMatchObject({ ultimoAtipico: false, esMasBarato: true });
  });

  it("if every vigente último costo is an outlier, nobody gets the badge and there is no difference", () => {
    const otro = agregado({ proveedorId: "pz", razonSocial: "Zeta", ultimoCosto: "7", costoMin: "7", costoMax: "7", partidasAtipicas: 1 });
    const r = armarComparacion(cruda({ limites, agregados: [bajoAtipico, altoAtipico, otro] }), null);
    expect(r.proveedores.every((f) => !f.esMasBarato && f.diferencia === null)).toBe(true);
    expect(r.sinOtrosProveedores).toBe(false);
  });

  it("a difference is never negative: a row below the minimum (only possible for an outlier) shows none", () => {
    const r = armarComparacion(cruda({ limites, agregados: [bajoAtipico, A, B] }), null);
    for (const f of r.proveedores) expect(f.diferencia === null || !f.diferencia.monto.startsWith("-"), f.proveedorId).toBe(true);
  });

  it("the bar scale ignores an outlier: one wrong-unit cost does not flatten the others to the minimum", () => {
    const r = armarComparacion(cruda({ limites, agregados: [A, B, altoAtipico] }), null);
    expect(fila(r, "pb").barraPorcentaje).toBe("100");
    expect(fila(r, "pa").barraPorcentaje).toBe("80");
  });

  it("a row above the scale is drawn at 100% (clamped), a tiny one at the 2% floor", () => {
    const r = armarComparacion(cruda({ limites, agregados: [A, B, altoAtipico, bajoAtipico] }), null);
    expect(fila(r, "py").barraPorcentaje).toBe("100");
    expect(fila(r, "px").barraPorcentaje).toBe("2");
  });

  it("the bar scale ignores baja proveedores too: a very expensive baja row does not shrink the vigentes", () => {
    const r = armarComparacion(cruda({ limites, agregados: [A, B, baja("pq", "0.05")] }), null);
    expect(fila(r, "pb").barraPorcentaje).toBe("100");
    expect(fila(r, "pa").barraPorcentaje).toBe("80");
    expect(fila(r, "pq").barraPorcentaje).toBe("100"); // above the scale: clamped
  });

  it("falls back to every row with cost when no vigente non-outlier row exists", () => {
    const r = armarComparacion(cruda({ limites, agregados: [baja("pq", "0.01"), baja("pr", "0.02"), altoAtipico] }), null);
    expect(fila(r, "py").barraPorcentaje).toBe("100"); // scale = the largest of all rows with cost (5)
    expect(fila(r, "pr").barraPorcentaje).toBe("2"); // 0.02 / 5 = 0.4%, floored
    expect(fila(r, "pq").barraPorcentaje).toBe("2");
  });
});

describe("armarComparacion -- display unit", () => {
  it("honors a requested unit of the same magnitude and converts accordingly", () => {
    const r = armarComparacion(cruda({ agregados: [A, B] }), "base");
    expect(r.unidadMostrada.codigo).toBe("MILIGRAMO");
    expect(r.convertida).toBe(false);
    expect(r.proveedores[0]).toMatchObject({ ultimoCosto: "0.01" });
    expect(r.proveedores[1]!.diferencia).toEqual({ monto: "0.0025", porcentaje: "25" });

    const kg = armarComparacion(cruda({ agregados: [A, B] }), "KILOGRAMO");
    expect(kg.proveedores[0]).toMatchObject({ ultimoCosto: "10000" });
    expect(kg.unidadSeleccionada).toBe("KILOGRAMO");
  });

  it("ignores a unit that does not fit the droga's magnitude (falls back to the default)", () => {
    const r = armarComparacion(cruda({ agregados: [A] }), "LITRO");
    expect(r.unidadMostrada.codigo).toBe("GRAMO");
  });

  it("a droga counted in unidades only offers its base, with no conversion", () => {
    const r = armarComparacion(cruda({ unidadBase: UNIDAD, unidadesCatalogo: [UNIDAD], agregados: [A] }), "GRAMO");
    expect(r.unidadMostrada.codigo).toBe("UNIDAD");
    expect(r.convertida).toBe(false);
    expect(r.opcionesUnidad).toHaveLength(1);
    expect(r.proveedores[0]!.ultimoCosto).toBe("0.01");
  });

  it("the percentage difference is the same in every unit", () => {
    for (const unidad of ["MICROGRAMO", "base", "GRAMO", "KILOGRAMO"]) {
      expect(armarComparacion(cruda({ agregados: [A, B] }), unidad).proveedores[1]!.diferencia!.porcentaje).toBe("25");
    }
  });
});

describe("armarComparacion -- antiguo and revisar flags", () => {
  it("'Antiguo' when the latest costed purchase is more than 12 months old (jornada of the tenant)", () => {
    const vieja = agregado({ proveedorId: "pv", razonSocial: "Vieja", ultimaCompra: new Date("2025-09-30T12:00:00Z") });
    const r = armarComparacion(cruda({ periodo: "todo", inicio: null, agregados: [A, vieja] }), null);
    expect(r.proveedores.find((f) => f.proveedorId === "pv")!.esAntiguo).toBe(true);
    expect(r.proveedores.find((f) => f.proveedorId === "pa")!.esAntiguo).toBe(false);
  });

  it("'Revisar' when any partida of the proveedor is an outlier", () => {
    const r = armarComparacion(cruda({ agregados: [agregado({ proveedorId: "pr", razonSocial: "R", partidasAtipicas: 1 }), A] }), null);
    expect(r.proveedores.find((f) => f.proveedorId === "pr")!.revisar).toBe(true);
    expect(r.proveedores.find((f) => f.proveedorId === "pa")!.revisar).toBe(false);
  });
});

describe("armarComparacion -- partidas detail", () => {
  const partida = (id: string, proveedorId: string, costoUnitario: string, extra: Partial<PartidaComparadorCruda> = {}): PartidaComparadorCruda => ({
    id,
    proveedorId,
    lote: `L-${id}`,
    fechaIngreso: new Date("2026-09-15T12:00:00Z"),
    cantidadInicial: "1500",
    costoUnitario,
    ...extra,
  });

  it("groups the partidas by proveedor, converts their cost, and flags outliers and cost 0", () => {
    const limites = limitesAtipicos("0.01", 5);
    const r = armarComparacion(
      cruda({
        limites,
        partidasConCosto: 5,
        agregados: [{ ...A, partidasTotal: 3, partidasAtipicas: 1 }, B],
        partidas: [partida("p1", "pa", "0.01"), partida("p2", "pa", "0.5"), partida("p3", "pa", "0"), partida("p4", "pb", "0.0125")],
      }),
      null,
    );
    const a = r.proveedores.find((f) => f.proveedorId === "pa")!;
    expect(a.partidas.map((p) => [p.id, p.costo, p.atipica, p.costoCero])).toEqual([
      ["p1", "10", false, false],
      ["p2", "500", true, false],
      ["p3", "0", false, true],
    ]);
    expect(a.partidas[0]).toMatchObject({ lote: "L-p1", cantidadInicial: "1500" });
    expect(r.proveedores.find((f) => f.proveedorId === "pb")!.partidas).toHaveLength(1);
    expect(a.partidasHayMas).toBe(false);
  });

  it("caps the detail at 50 and reports there are more", () => {
    const muchas = Array.from({ length: PARTIDAS_DETALLE_MAX + 5 }, (_, i) => partida(`p${i}`, "pa", "0.01"));
    const r = armarComparacion(cruda({ agregados: [{ ...A, partidasTotal: 120 }], partidas: muchas }), null);
    const a = r.proveedores[0]!;
    expect(a.partidas).toHaveLength(PARTIDAS_DETALLE_MAX);
    expect(a.partidasTotal).toBe(120);
    expect(a.partidasHayMas).toBe(true);
  });

  it("a proveedor whose partidas are all shown has no 'hay más'", () => {
    const r = armarComparacion(cruda({ agregados: [{ ...A, partidasTotal: 2 }], partidas: [partida("p1", "pa", "0.01"), partida("p2", "pa", "0.01")] }), null);
    expect(r.proveedores[0]!.partidasHayMas).toBe(false);
  });

  it("flags nothing when there is no outlier band", () => {
    const r = armarComparacion(cruda({ limites: null, agregados: [A], partidas: [partida("p1", "pa", "9999")] }), null);
    expect(r.proveedores[0]!.partidas[0]!.atipica).toBe(false);
  });
});
