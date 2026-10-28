/**
 * Costo de proveedor as a cost source of the cotización and the presupuesto
 * (openspec/specs/costos-proveedor/spec.md R25-R32; CP12, CP15, CP16). Pure domain, no
 * DB. CP13 ("without a costo de proveedor everything is as before") is the
 * untouched `precios-calcular-cotizacion.test.ts`; the equality test below
 * only makes the golden rule explicit.
 */
import { describe, it, expect } from "vitest";
import { calcularCotizacion, calcularCotizacionesAcumuladas, leerDetalleCotizacion } from "@/modules/precios/domain/calcular-cotizacion";
import type { CostoProveedorCosteo, CotizacionDetalle, LineaCosteoInput, PartidaCosteo } from "@/modules/precios/domain/calcular-cotizacion";
import type { ReglasPrecio } from "@/modules/precios/domain/regla-precio";

const HOY = "2026-06-15";

function margenUnico(margen: string): ReglasPrecio {
  return { precioMinimo: "0", tramos: [{ costoHasta: null, margen }] };
}

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

function linea(overrides: Partial<LineaCosteoInput>): LineaCosteoInput {
  return {
    drogaId: "droga-1",
    drogaNombre: "Droga 1",
    unidadSimbolo: "g",
    unidad: GRAMO,
    unidadStock: GRAMO,
    cantidadAPesar: "10",
    esEnraseManual: false,
    orden: 0,
    ...overrides,
  };
}

function partida(overrides: Partial<PartidaCosteo>): PartidaCosteo {
  return { id: "P1", cantidadDisponible: "100", fechaVencimiento: "2026-12-31", fechaApertura: null, costoUnitario: "1", ...overrides };
}

const sinPartidas = () => [] as PartidaCosteo[];

describe("calcularCotizacion -- línea con costo de proveedor (R25, R28; CP12)", () => {
  it("costs the WHOLE quantity at the costo de proveedor, ignoring the partidas' cost: fuente PROVEEDOR, partidas empty", () => {
    const partidas = [partida({ cantidadDisponible: "100", costoUnitario: "1" })];
    const resultado = calcularCotizacion([linea({ cantidadAPesar: "10", costoProveedor: costo() })], () => partidas, HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("50"); // 10 g x 5, not x 1
    expect(resultado.esIncompleta).toBe(false);
    const detalle = resultado.detalle.lineas[0]!;
    expect(detalle.fuente).toBe("PROVEEDOR");
    expect(detalle.partidas).toEqual([]);
    expect(detalle.subtotal).toBe("50");
    expect(detalle.faltante).toBeNull();
    expect(detalle.costoProveedor).toEqual(costo());
  });

  it("with partial stock: whole quantity still costed, faltante informational (in the línea's unit), NOT esIncompleta", () => {
    const partidas = [partida({ cantidadDisponible: "4", costoUnitario: "1" })];
    const resultado = calcularCotizacion([linea({ cantidadAPesar: "10", costoProveedor: costo() })], () => partidas, HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("50");
    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.detalle.lineas[0]!.faltante).toBe("6");
    expect(resultado.detalle.lineas[0]!.partidas).toEqual([]);
  });

  it("with zero stock: whole quantity costed, no esIncompleta (the cost is complete), faltante = everything", () => {
    const resultado = calcularCotizacion([linea({ cantidadAPesar: "10", costoProveedor: costo() })], sinPartidas, HOY, margenUnico("100"));

    expect(resultado.costoInsumos.toString()).toBe("50");
    expect(resultado.precioFinal.toString()).toBe("100"); // the margen applies on the proveedor cost as on any cost (R31)
    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.esParcial).toBe(false);
    expect(resultado.detalle.lineas[0]!.faltante).toBe("10");
  });

  it("an expired-only stock also counts as no stock (informational faltante), never changes the cost", () => {
    const partidas = [partida({ cantidadDisponible: "100", fechaVencimiento: "2026-01-01" })];
    const resultado = calcularCotizacion([linea({ costoProveedor: costo() })], () => partidas, HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("50");
    expect(resultado.detalle.lineas[0]!.faltante).toBe("10");
    expect(resultado.esIncompleta).toBe(false);
  });

  it("converts the línea's quantity into the droga's unidad base: 950 g x 0.040898 $/mg = 38853.1", () => {
    const lineas = [linea({ cantidadAPesar: "950", unidad: GRAMO, unidadStock: MILIGRAMO, costoProveedor: costo({ precioInformado: "40898", costoUnitario: "0.040898" }) })];
    const resultado = calcularCotizacion(lineas, sinPartidas, HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("38853.1");
    expect(resultado.detalle.lineas[0]!.cantidadRequerida).toBe("950"); // still in the línea's unit
    expect(resultado.detalle.lineas[0]!.faltante).toBe("950"); // reported in g, not mg
  });

  it("a manual-enrase línea is not costed even when its droga has a costo de proveedor (R29)", () => {
    const lineas = [linea({ cantidadAPesar: null, esEnraseManual: true, costoProveedor: costo() })];
    const resultado = calcularCotizacion(lineas, sinPartidas, HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("0");
    expect(resultado.esParcial).toBe(true);
    const detalle = resultado.detalle.lineas[0]!;
    expect(detalle).toMatchObject({ esEnraseManual: true, cantidadRequerida: null, partidas: [], subtotal: "0", faltante: null });
    expect(detalle.costoProveedor).toBeUndefined();
  });

  it("a línea whose unit can not be converted (different magnitud) is not costed even with a costo de proveedor (R29)", () => {
    const lineas = [linea({ cantidadAPesar: "10", unidad: MILILITRO, unidadStock: GRAMO, costoProveedor: costo() })];
    const resultado = calcularCotizacion(lineas, sinPartidas, HOY, margenUnico("0"));

    expect(resultado.costoInsumos.toString()).toBe("0");
    expect(resultado.esParcial).toBe(true);
    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.detalle.lineas[0]).toMatchObject({ partidas: [], subtotal: "0", faltante: null });
    expect(resultado.detalle.lineas[0]!.costoProveedor).toBeUndefined();
  });
});

describe("calcularCotizacion -- sin costo de proveedor (R27, CP13)", () => {
  it("`null` and absent costoProveedor give no price: drogasSinPrecio, subtotal 0, no fuente, partidas empty, esIncompleta false", () => {
    const partidas = [partida({ id: "P1", cantidadDisponible: "4", costoUnitario: "5" })];
    const base = linea({ cantidadAPesar: "10" });

    const ausente = calcularCotizacion([base], () => partidas, HOY, margenUnico("0"));
    const nulo = calcularCotizacion([{ ...base, costoProveedor: null }], () => partidas, HOY, margenUnico("0"));

    expect(nulo).toEqual(ausente);
    expect(ausente.costoInsumos.toString()).toBe("0");
    expect(ausente.esIncompleta).toBe(false);
    expect(ausente.drogasSinPrecio).toEqual(["Droga 1"]);
    expect(ausente.detalle.lineas[0]).toMatchObject({
      partidas: [],
      subtotal: "0",
      faltante: "6",
    });
    expect(ausente.detalle.lineas[0]!.fuente).toBeUndefined();
    expect(ausente.detalle.lineas[0]!.costoProveedor).toBeUndefined();
  });
});

describe("calcularCotizacion -- item with mixed drogas (CP15, R27, R31)", () => {
  it("mixed item (one droga with costo, one without): drogasSinPrecio lists the unpriced droga, partidas never cost the missing one", () => {
    const lineas = [
      linea({ drogaId: "A", drogaNombre: "Droga A", orden: 0, cantidadAPesar: "10", costoProveedor: costo({ costoUnitario: "5" }) }),
      linea({ drogaId: "B", drogaNombre: "Droga B", orden: 1, cantidadAPesar: "10", costoProveedor: null }),
    ];
    const partidas: Record<string, PartidaCosteo[]> = { B: [partida({ id: "PB", cantidadDisponible: "100", costoUnitario: "2" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id] ?? [], HOY, margenUnico("0"));

    expect(resultado.drogasSinPrecio).toEqual(["Droga B"]);
    expect(resultado.costoInsumos.toString()).toBe("50");
    expect(resultado.detalle.lineas[0]!.fuente).toBe("PROVEEDOR");
    expect(resultado.detalle.lineas[1]!.fuente).toBeUndefined();
    expect(resultado.detalle.lineas[1]!.partidas).toEqual([]);
    expect(resultado.detalle.lineas[1]!.subtotal).toBe("0");
    expect(resultado.esIncompleta).toBe(false);
  });

  it("the precio mínimo applies once on the sum, whatever the sources", () => {
    const lineas = [linea({ costoProveedor: costo({ costoUnitario: "1" }) })];
    const resultado = calcularCotizacion(lineas, sinPartidas, HOY, { precioMinimo: "500", tramos: [{ costoHasta: null, margen: "10" }] });

    expect(resultado.costoInsumos.toString()).toBe("10");
    expect(resultado.precioMinimoAplicado).toBe(true);
    expect(resultado.precioFinal.toString()).toBe("500");
  });

  it("droga without costo de proveedor short of stock: reports informational faltante, esIncompleta is false (R28)", () => {
    const lineas = [
      linea({ drogaId: "A", drogaNombre: "A", orden: 0, costoProveedor: costo() }),
      linea({ drogaId: "B", drogaNombre: "B", orden: 1, cantidadAPesar: "10", costoProveedor: null }),
    ];
    const resultado = calcularCotizacion(lineas, () => [], HOY, margenUnico("0"));

    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.drogasSinPrecio).toEqual(["B"]);
    expect(resultado.detalle.lineas[0]!.faltante).toBe("10");
    expect(resultado.detalle.lineas[1]!.faltante).toBe("10");
  });

  it("the detalle (with the snapshot of the costo) survives a JSON round trip: it is stored as jsonb", () => {
    const resultado = calcularCotizacion([linea({ costoProveedor: costo() })], sinPartidas, HOY, margenUnico("0"));
    expect(JSON.parse(JSON.stringify(resultado.detalle))).toEqual(resultado.detalle);
  });
});

describe("calcularCotizacionesAcumuladas -- presupuesto with costos de proveedor (R30)", () => {
  const A = (cantidad = "10") => linea({ drogaId: "A", drogaNombre: "A", orden: 0, cantidadAPesar: cantidad, costoProveedor: costo() });
  const B = (cantidad = "10") => linea({ drogaId: "B", drogaNombre: "B", orden: 1, cantidadAPesar: cantidad, costoProveedor: null });

  it("a PROVEEDOR línea costs the same in every item, but still consumes simulated stock so the next item's faltante is right", () => {
    const partidas: Record<string, PartidaCosteo[]> = { A: [partida({ id: "PA", cantidadDisponible: "15", costoUnitario: "1" })] };
    const [primero, segundo] = calcularCotizacionesAcumuladas([[A()], [A()]], (id) => partidas[id] ?? [], HOY, margenUnico("0"));

    expect(primero!.costoInsumos.toString()).toBe("50");
    expect(primero!.detalle.lineas[0]!.faltante).toBeNull();
    expect(segundo!.costoInsumos.toString()).toBe("50"); // never depends on the simulation
    expect(segundo!.detalle.lineas[0]!.faltante).toBe("5"); // 20 g needed in total, 15 g in stock
    expect(segundo!.detalle.lineas[0]!.partidas).toEqual([]);
    expect(segundo!.esIncompleta).toBe(false);
  });

  it("every línea, priced or not, consumes stock in the cumulative simulation so later items see the remainder", () => {
    const partidas: Record<string, PartidaCosteo[]> = {
      A: [partida({ id: "PA", cantidadDisponible: "100", costoUnitario: "1" })],
      B: [partida({ id: "PB", cantidadDisponible: "15", costoUnitario: "2" })],
    };
    const [primero, segundo] = calcularCotizacionesAcumuladas([[A(), B()], [A(), B()]], (id) => partidas[id] ?? [], HOY, margenUnico("0"));

    expect(primero!.costoInsumos.toString()).toBe("50");
    expect(primero!.drogasSinPrecio).toEqual(["B"]);
    expect(primero!.esIncompleta).toBe(false);

    expect(segundo!.costoInsumos.toString()).toBe("50");
    expect(segundo!.drogasSinPrecio).toEqual(["B"]);
    expect(segundo!.esIncompleta).toBe(false);

    expect(segundo!.detalle.lineas.map((l) => [l.fuente, l.faltante])).toEqual([
      ["PROVEEDOR", null],
      [undefined, "5"],
    ]);
  });

  it("when both drogas have costo de proveedor, both items are priced and the second reports the simulated faltante without esIncompleta", () => {
    const BConCosto = (cantidad = "10") => linea({ drogaId: "B", drogaNombre: "B", orden: 1, cantidadAPesar: cantidad, costoProveedor: costo({ costoUnitario: "2" }) });
    const partidas: Record<string, PartidaCosteo[]> = {
      A: [partida({ id: "PA", cantidadDisponible: "100", costoUnitario: "1" })],
      B: [partida({ id: "PB", cantidadDisponible: "15", costoUnitario: "2" })],
    };
    const [primero, segundo] = calcularCotizacionesAcumuladas([[A(), BConCosto()], [A(), BConCosto()]], (id) => partidas[id] ?? [], HOY, margenUnico("0"));

    expect(primero!.costoInsumos.toString()).toBe("70"); // 10*5 + 10*2
    expect(primero!.esIncompleta).toBe(false);
    expect(segundo!.costoInsumos.toString()).toBe("70"); // whole quantity costed at proveedor cost
    expect(segundo!.esIncompleta).toBe(false);
    expect(segundo!.detalle.lineas.map((l) => [l.fuente, l.faltante])).toEqual([
      ["PROVEEDOR", null],
      ["PROVEEDOR", "5"],
    ]);
  });

  it("does not mutate the caller's partidas", () => {
    const original = [partida({ id: "PA", cantidadDisponible: "15" })];
    calcularCotizacionesAcumuladas([[A()], [A()]], () => original, HOY, margenUnico("0"));
    expect(original[0]!.cantidadDisponible).toBe("15");
  });
});

describe("leerDetalleCotizacion -- stored detalle read for display (R32, CP16)", () => {
  const base = { orden: 0, drogaId: "d", drogaNombre: "D", unidadSimbolo: "g", esEnraseManual: false, cantidadRequerida: "10", subtotal: "50", faltante: null };

  it("an OLD detalle (no `fuente`) is read as PARTIDAS and flagged as not recorded", () => {
    const viejo = { lineas: [{ ...base, partidas: [{ partidaId: "P1", cantidad: "10", costoUnitario: "5", subtotal: "50" }] }] } as CotizacionDetalle;
    const [l] = leerDetalleCotizacion(viejo).lineas;

    expect(l).toMatchObject({ fuente: "PARTIDAS", fuenteRegistrada: false, costoProveedor: null, subtotal: "50" });
    expect(l!.partidas).toHaveLength(1);
  });

  it("a PROVEEDOR línea keeps its snapshot; a PARTIDAS one written by the new code is flagged as recorded", () => {
    const nuevo = { lineas: [{ ...base, partidas: [], fuente: "PROVEEDOR", costoProveedor: costo() }, { ...base, orden: 1, partidas: [], fuente: "PARTIDAS" }] } as CotizacionDetalle;
    const [proveedor, partidas] = leerDetalleCotizacion(nuevo).lineas;

    expect(proveedor).toMatchObject({ fuente: "PROVEEDOR", fuenteRegistrada: true, costoProveedor: costo() });
    expect(partidas).toMatchObject({ fuente: "PARTIDAS", fuenteRegistrada: true, costoProveedor: null });
  });

  it("round trip: what the calculation stores reads back with the same fuente", () => {
    const resultado = calcularCotizacion([linea({ costoProveedor: costo() })], sinPartidas, HOY, margenUnico("0"));
    const almacenado = JSON.parse(JSON.stringify(resultado.detalle)) as CotizacionDetalle;
    expect(leerDetalleCotizacion(almacenado).lineas[0]).toMatchObject({ fuente: "PROVEEDOR", fuenteRegistrada: true, costoProveedor: costo() });
  });
});
