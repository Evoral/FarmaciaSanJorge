/**
 * Unit tests for modules/costos-proveedor/domain/costo-proveedor.ts
 * (docs/specs/costos-proveedor.md: CP1-CP7 domain parts, R4-R10, R18, R26).
 */
import { describe, it, expect } from "vitest";
import { DomainError } from "@/shared/errors";
import type { UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import {
  calcularCostoUnidadBase,
  detectarDuplicados,
  elegirCostoProveedor,
  fechaPrecioSchema,
  filaCostoSchema,
  planVersionar,
  precioInformadoSchema,
  unidadPrecioPorDefecto,
  validarFilaCosto,
  type CandidatoCostoProveedor,
  type UnidadParaCosto,
} from "@/modules/costos-proveedor/domain/costo-proveedor";

// The seeded catalog (migration 0006): factor_a_base relative to each magnitud's base unit.
const MG: UnidadDeConversion = { factorABase: "0.001", tipoMagnitud: "MASA" };
const G: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "MASA" };
const KG: UnidadDeConversion = { factorABase: "1000", tipoMagnitud: "MASA" };
const ML: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "VOLUMEN" };
const L: UnidadDeConversion = { factorABase: "1000", tipoMagnitud: "VOLUMEN" };
const U: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "UNIDADES" };

const KG_ID = "11111111-1111-4111-a111-111111111111";
const L_ID = "22222222-2222-4222-a222-222222222222";
const DROGA_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const DROGA_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

function unidadParaCosto(base: UnidadDeConversion, extra: Partial<UnidadParaCosto> = {}): UnidadParaCosto {
  return { ...base, id: KG_ID, codigo: "KILOGRAMO", fechaBaja: null, ...extra };
}

describe("calcularCostoUnidadBase (R4, CP1)", () => {
  it("CP1: 40898 per kg is 0.040898 per mg and 40.898 per g", () => {
    expect(calcularCostoUnidadBase("40898", KG, MG)).toBe("0.040898");
    expect(calcularCostoUnidadBase("40898", KG, G)).toBe("40.898");
  });

  it("converts per L into per mL, and keeps the price when the unit is the unidad base", () => {
    expect(calcularCostoUnidadBase("5000", L, ML)).toBe("5");
    expect(calcularCostoUnidadBase("123.45", U, U)).toBe("123.45");
    expect(calcularCostoUnidadBase("40898", KG, KG)).toBe("40898");
  });

  it("converts a price per unit smaller than the unidad base (per mg into per g)", () => {
    expect(calcularCostoUnidadBase("0.5", MG, G)).toBe("500");
  });

  it("rounds to 10 decimals half-up and never returns an exponent", () => {
    // 12.3 per kg in mg = 0.0000123 (exact).
    expect(calcularCostoUnidadBase("12.3", KG, MG)).toBe("0.0000123");
    // 1.23456789 / 1e6 = 0.00000123456789 -> 10 decimals: 0.0000012346 (the 11th digit is 6, rounds up).
    expect(calcularCostoUnidadBase("1.23456789", KG, MG)).toBe("0.0000012346");
    // 1.2345678 / 1e6 = 0.0000012345678 -> 10 decimals: 0.0000012346 as well.
    expect(calcularCostoUnidadBase("1.2345678", KG, MG)).toBe("0.0000012346");
    // Exactly half: 0.00005 per kg in mg = 5e-11 -> rounds half-up to 1e-10.
    expect(calcularCostoUnidadBase("0.00005", KG, MG)).toBe("0.0000000001");
    // Just under half rounds down to zero.
    expect(calcularCostoUnidadBase("0.00004", KG, MG)).toBe("0");
  });

  it("CP2: refuses a unidad of another magnitud (R5)", () => {
    expect(() => calcularCostoUnidadBase("100", L, MG)).toThrow(DomainError);
    expect(() => calcularCostoUnidadBase("100", KG, ML)).toThrow(DomainError);
    expect(() => calcularCostoUnidadBase("100", U, G)).toThrow(DomainError);
  });
});

describe("unidadPrecioPorDefecto (R6)", () => {
  it("masa -> kg, volumen -> L, unidades -> u (codes of the seeded catalog)", () => {
    expect(unidadPrecioPorDefecto("MASA")).toBe("KILOGRAMO");
    expect(unidadPrecioPorDefecto("VOLUMEN")).toBe("LITRO");
    expect(unidadPrecioPorDefecto("UNIDADES")).toBe("UNIDAD");
  });
});

describe("precioInformadoSchema (R3, CP3)", () => {
  it("accepts a positive decimal and returns the exact canonical string", () => {
    expect(precioInformadoSchema.parse("40898")).toBe("40898");
    expect(precioInformadoSchema.parse(" 40898.50 ")).toBe("40898.5");
    expect(precioInformadoSchema.parse("1,5")).toBe("1.5");
    expect(precioInformadoSchema.parse("0.0000001")).toBe("0.0000001");
  });

  it("CP3: rejects zero, negative, empty and non-numeric input", () => {
    for (const invalido of ["0", "0.00", "-1", "-0.5", "", "   ", "abc", "1e3", "0x10", "Infinity", "NaN", "12."]) {
      expect(precioInformadoSchema.safeParse(invalido).success, JSON.stringify(invalido)).toBe(false);
    }
  });

  it("says why", () => {
    expect(precioInformadoSchema.safeParse("0").error?.issues[0]?.message).toBe("Debe ser mayor que cero.");
    expect(precioInformadoSchema.safeParse("").error?.issues[0]?.message).toBe("Ingresá el precio.");
    expect(precioInformadoSchema.safeParse("abc").error?.issues[0]?.message).toBe(
      '"abc" no es un número válido. Usá coma para los decimales (1,5) y no separes los miles (1500).',
    );
  });
});

describe("fechaPrecioSchema (R8)", () => {
  const schema = fechaPrecioSchema("2026-10-15");

  it("accepts the jornada actual and earlier dates", () => {
    expect(schema.safeParse("2026-10-15").success).toBe(true);
    expect(schema.safeParse("2026-01-01").success).toBe(true);
  });

  it("rejects a date after the jornada", () => {
    const result = schema.safeParse("2026-10-16");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("La fecha del precio no puede ser posterior a hoy.");
  });

  it("rejects malformed and impossible dates", () => {
    for (const invalida of ["", "15/10/2026", "2026-2-3", "2026-02-31", "2026-13-01", "no es fecha"]) {
      expect(schema.safeParse(invalida).success, invalida).toBe(false);
    }
  });
});

describe("filaCostoSchema", () => {
  const schema = filaCostoSchema("2026-10-15");
  const base = { drogaId: DROGA_A, precioInformado: "40898", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-01" };

  it("parses a valid row; blank optional texts become null and motivo is trimmed", () => {
    const parsed = schema.parse({ ...base, descripcionProveedor: "   ", motivo: "  ajuste de lista  " });
    expect(parsed).toEqual({ ...base, descripcionProveedor: null, motivo: "ajuste de lista" });
    expect(schema.parse(base)).toEqual({ ...base, descripcionProveedor: null, motivo: null });
  });

  it("reports the offending field", () => {
    const result = schema.safeParse({ ...base, precioInformado: "0", fechaPrecio: "2026-10-16" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual(["fechaPrecio", "precioInformado"]);
  });

  it("rejects ids that are not uuids", () => {
    expect(schema.safeParse({ ...base, drogaId: "x" }).success).toBe(false);
    expect(schema.safeParse({ ...base, unidadPrecioId: "x" }).success).toBe(false);
  });
});

describe("validarFilaCosto (R5, R4)", () => {
  it("returns the costo unitario of a valid row", () => {
    expect(validarFilaCosto({ precioInformado: "40898", unidadPrecio: unidadParaCosto(KG), unidadBase: MG })).toEqual({ ok: true, costoUnitario: "0.040898" });
  });

  it("CP2: rejects another magnitud", () => {
    const result = validarFilaCosto({ precioInformado: "40898", unidadPrecio: unidadParaCosto(L, { id: L_ID, codigo: "LITRO" }), unidadBase: MG });
    expect(result).toMatchObject({ ok: false, problema: "OTRA_MAGNITUD" });
  });

  it("rejects a unidad dada de baja", () => {
    const result = validarFilaCosto({ precioInformado: "40898", unidadPrecio: unidadParaCosto(KG, { fechaBaja: new Date("2026-01-01") }), unidadBase: MG });
    expect(result).toMatchObject({ ok: false, problema: "UNIDAD_DE_BAJA" });
  });

  it("rejects a price so low that the converted cost rounds to zero", () => {
    const result = validarFilaCosto({ precioInformado: "0.00004", unidadPrecio: unidadParaCosto(KG), unidadBase: MG });
    expect(result).toMatchObject({ ok: false, problema: "COSTO_NULO" });
  });
});

describe("planVersionar (R9, R10, CP4-CP6)", () => {
  const vigente = { id: "vigente-1", precioInformado: "40898", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-01" };

  it("no vigente: INSERTAR (CP4, first version)", () => {
    expect(planVersionar({ vigente: null, nuevo: { precioInformado: "40898", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-01" } })).toEqual({ tipo: "INSERTAR" });
  });

  it("a different price: REEMPLAZAR closing the vigente (CP4)", () => {
    expect(planVersionar({ vigente, nuevo: { precioInformado: "41000", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-05" } })).toEqual({ tipo: "REEMPLAZAR", cerrarId: "vigente-1" });
  });

  it("same date, different price: REEMPLAZAR", () => {
    expect(planVersionar({ vigente, nuevo: { precioInformado: "41000", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-01" } })).toEqual({ tipo: "REEMPLAZAR", cerrarId: "vigente-1" });
  });

  it("same price, unidad and date: SIN_CAMBIOS (CP6), comparing the price as a decimal", () => {
    expect(planVersionar({ vigente, nuevo: { precioInformado: "40898", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-01" } })).toEqual({ tipo: "SIN_CAMBIOS" });
    expect(planVersionar({ vigente, nuevo: { precioInformado: "40898.00", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-01" } })).toEqual({ tipo: "SIN_CAMBIOS" });
  });

  it("same price with a later date: REEMPLAZAR (CP6)", () => {
    expect(planVersionar({ vigente, nuevo: { precioInformado: "40898", unidadPrecioId: KG_ID, fechaPrecio: "2026-10-10" } })).toEqual({ tipo: "REEMPLAZAR", cerrarId: "vigente-1" });
  });

  it("same price and date in another unidad: REEMPLAZAR", () => {
    expect(planVersionar({ vigente, nuevo: { precioInformado: "40898", unidadPrecioId: L_ID, fechaPrecio: "2026-10-01" } })).toEqual({ tipo: "REEMPLAZAR", cerrarId: "vigente-1" });
  });

  it("an older fecha_precio is refused, even with the same price (CP5)", () => {
    expect(planVersionar({ vigente, nuevo: { precioInformado: "50000", unidadPrecioId: KG_ID, fechaPrecio: "2026-09-30" } })).toEqual({ tipo: "RECHAZAR", motivo: "MAS_ANTIGUA" });
    expect(planVersionar({ vigente, nuevo: { precioInformado: "40898", unidadPrecioId: KG_ID, fechaPrecio: "2026-09-30" } })).toEqual({ tipo: "RECHAZAR", motivo: "MAS_ANTIGUA" });
  });
});

describe("detectarDuplicados (R18, CP7)", () => {
  it("flags EVERY row of a droga that appears more than once, in ascending order", () => {
    const filas = [{ drogaId: DROGA_A }, { drogaId: DROGA_B }, { drogaId: DROGA_A }, { drogaId: "otra" }, { drogaId: DROGA_A }, { drogaId: DROGA_B }];
    expect(detectarDuplicados(filas)).toEqual([0, 1, 2, 4, 5]);
  });

  it("returns nothing when every droga is unique", () => {
    expect(detectarDuplicados([{ drogaId: DROGA_A }, { drogaId: DROGA_B }])).toEqual([]);
    expect(detectarDuplicados([])).toEqual([]);
  });

  it("rows without a droga (sin asociar) never collide", () => {
    expect(detectarDuplicados([{ drogaId: null }, { drogaId: null }, { drogaId: undefined }, { drogaId: DROGA_A }])).toEqual([]);
  });
});

describe("elegirCostoProveedor (R26, CP14)", () => {
  function candidato(id: string, fechaPrecio: string, vigenteDesde: string, proveedorDeBaja = false): CandidatoCostoProveedor & { id: string } {
    return { id, fechaPrecio, vigenteDesde: new Date(vigenteDesde), proveedorDeBaja };
  }

  it("returns null when there is no candidate", () => {
    expect(elegirCostoProveedor([])).toBeNull();
  });

  it("picks the latest fecha_precio", () => {
    const elegido = elegirCostoProveedor([
      candidato("a", "2026-09-01", "2026-09-02T10:00:00Z"),
      candidato("b", "2026-10-01", "2026-10-02T10:00:00Z"),
      candidato("c", "2026-09-15", "2026-10-03T10:00:00Z"),
    ]);
    expect(elegido?.id).toBe("b");
  });

  it("a tie on fecha_precio goes to the latest vigente_desde", () => {
    const elegido = elegirCostoProveedor([
      candidato("a", "2026-10-01", "2026-10-02T10:00:00Z"),
      candidato("b", "2026-10-01", "2026-10-02T12:00:00Z"),
      candidato("c", "2026-10-01", "2026-10-02T09:00:00Z"),
    ]);
    expect(elegido?.id).toBe("b");
  });

  it("a full tie keeps the first candidate", () => {
    const elegido = elegirCostoProveedor([candidato("a", "2026-10-01", "2026-10-02T10:00:00Z"), candidato("b", "2026-10-01", "2026-10-02T10:00:00Z")]);
    expect(elegido?.id).toBe("a");
  });

  it("ignores a proveedor de baja, even when its price is the newest", () => {
    const elegido = elegirCostoProveedor([candidato("baja", "2026-10-10", "2026-10-10T10:00:00Z", true), candidato("vigente", "2026-09-01", "2026-09-01T10:00:00Z")]);
    expect(elegido?.id).toBe("vigente");
  });

  it("returns null when every proveedor is de baja", () => {
    expect(elegirCostoProveedor([candidato("a", "2026-10-10", "2026-10-10T10:00:00Z", true)])).toBeNull();
  });

  it("does not depend on the input order", () => {
    const filas = [candidato("a", "2026-09-01", "2026-09-01T10:00:00Z"), candidato("b", "2026-10-01", "2026-10-01T10:00:00Z"), candidato("c", "2026-10-01", "2026-10-01T11:00:00Z")];
    expect(elegirCostoProveedor(filas)?.id).toBe("c");
    expect(elegirCostoProveedor([...filas].reverse())?.id).toBe("c");
  });
});
