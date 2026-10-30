/**
 * Unit tests for the pure domain of openspec/changes/lotes-elaborados:
 * modules/stock/domain/elaboracion-lote.ts (EL2, EL4, EL5), modules/drogas/domain/formula.ts (EL3, INV-EL5),
 * modules/costos-proveedor/domain/costo-desde-formula.ts (R38, R27) and the P13 helpers of
 * modules/preparaciones/domain/pesada-real.ts.
 */
import { describe, it, expect } from "vitest";
import { DomainError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import {
  costoUnitarioDeLote,
  potenciaDeDilucion,
  prefijoLoteElaborado,
  codigoLoteElaborado,
  validarElaboracion,
  vencimientoMaximo,
  type ConsumoElaboracion,
  type ElaboracionInput,
} from "@/modules/stock/domain/elaboracion-lote";
import { escalarFormula, validarFormula, type ValidarFormulaInput } from "@/modules/drogas/domain/formula";
import { costoDesdeFormula } from "@/modules/costos-proveedor/domain/costo-desde-formula";
import { bajoLaBalanza, sugerenciaPesadaReal } from "@/modules/preparaciones/domain/pesada-real";
import {
  calcularCotizacion,
  leerDetalleCotizacion,
  type CostoFormulaCosteo,
  type CostoProveedorCosteo,
  type LineaCosteoInput,
} from "@/modules/precios/domain/calcular-cotizacion";
import type { ReglasPrecio } from "@/modules/precios/domain/regla-precio";
import { presupuestoItemDesdeCotizacion } from "@/modules/recetas/domain/presupuesto";
import { pesadaDeLinea } from "@/modules/preparaciones/ui/confirmar-form";
import type { DatosConfirmacion, LineaPantalla } from "@/modules/preparaciones/application/datos-confirmacion";

const JORNADA = "2026-10-29";

function consumo(overrides: Partial<ConsumoElaboracion>): ConsumoElaboracion {
  return {
    partidaId: "p-x",
    lote: "L1",
    drogaId: "droga-x",
    drogaNombre: "Droga X",
    cantidad: "1",
    cantidadDisponible: "10",
    costoUnitario: "1000",
    potenciaDeclarada: null,
    fechaVencimiento: "2027-06-01",
    ...overrides,
  };
}

const LACTOSA = consumo({ partidaId: "p-lac", lote: "LAC1", drogaId: "lactosa", drogaNombre: "Lactosa", cantidad: "99", cantidadDisponible: "500", costoUnitario: "10", fechaVencimiento: "2027-03-01" });

function dilucion(overrides: Partial<ElaboracionInput> = {}): ElaboracionInput {
  return {
    tipo: "DILUCION",
    drogaProducidaId: "droga-x",
    drogaProducidaRequiereVencimiento: true,
    cantidadProducida: "100",
    fechaVencimiento: null,
    consumos: [consumo({}), LACTOSA],
    jornada: JORNADA,
    ...overrides,
  };
}

function campos(fn: () => unknown): readonly string[] | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).fields;
  }
  throw new Error("expected a DomainError");
}

describe("elaboracion-lote -- EL2 dilución", () => {
  it("1 g of X at 100 % + 99 g of lactosa into 100 g -> X at 1 %", () => {
    const lote = validarElaboracion(dilucion());
    expect(lote.potenciaDeclarada!.toString()).toBe("1");
  });

  it("a diluted lot diluted again multiplies the purities: 10 g at 1 % into 100 g -> 0,1 %", () => {
    const potencia = potenciaDeDilucion([consumo({ cantidad: "10", potenciaDeclarada: "1" }), LACTOSA], "droga-x", "100");
    expect(potencia.toString()).toBe("0.1");
  });

  it("rounds the potencia DOWN, and the active it then holds stays within INV-EL3's 10^-4", () => {
    const consumos = [consumo({ cantidad: "1" }), LACTOSA];
    const potencia = potenciaDeDilucion(consumos, "droga-x", "3");
    expect(potencia.toString()).toBe("33.333333");
    const activoProducido = dec(3).times(potencia).dividedBy(100);
    expect(dec(1).minus(activoProducido).lessThan("0.0001")).toBe(true);
    expect(activoProducido.lessThanOrEqualTo(1)).toBe(true);
  });

  it("refuses a dilución that does not consume its droga", () => {
    expect(campos(() => validarElaboracion(dilucion({ consumos: [LACTOSA] })))).toEqual(["componentes"]);
  });

  it("refuses a cantidad producida below the active consumed (potencia > 100)", () => {
    expect(campos(() => validarElaboracion(dilucion({ cantidadProducida: "0.5", consumos: [consumo({})] })))).toEqual(["cantidadProducida"]);
  });
});

describe("elaboracion-lote -- FORMULA lot", () => {
  it("has no potencia and never consumes its own droga", () => {
    const formula = dilucion({ tipo: "FORMULA", drogaProducidaId: "jarabe", consumos: [LACTOSA] });
    expect(validarElaboracion(formula).potenciaDeclarada).toBeNull();
    expect(campos(() => validarElaboracion({ ...formula, drogaProducidaId: "lactosa" }))).toEqual(["componentes"]);
  });
});

describe("elaboracion-lote -- EL4 costo", () => {
  it("(1 g x $1000 + 99 g x $10) / 100 g = $19,90/g", () => {
    expect(costoUnitarioDeLote([consumo({}), LACTOSA], "100").toString()).toBe("19.9");
    expect(validarElaboracion(dilucion()).costoUnitario.toString()).toBe("19.9");
  });
});

describe("elaboracion-lote -- EL5 vencimiento", () => {
  it("defaults to the earliest vencimiento consumed; non-expiring partidas do not bound it", () => {
    expect(vencimientoMaximo([consumo({}), LACTOSA, consumo({ partidaId: "p-vidrio", fechaVencimiento: null })])).toBe("2027-03-01");
    expect(validarElaboracion(dilucion()).fechaVencimiento).toBe("2027-03-01");
  });

  it("accepts an earlier date and refuses a later one", () => {
    expect(validarElaboracion(dilucion({ fechaVencimiento: "2027-01-15" })).fechaVencimiento).toBe("2027-01-15");
    expect(campos(() => validarElaboracion(dilucion({ fechaVencimiento: "2027-05-01" })))).toEqual(["fechaVencimiento"]);
  });

  it("asks for a date when nothing consumed expires and the product is a DROGA", () => {
    const sinVencimiento = [consumo({ fechaVencimiento: null }), { ...LACTOSA, fechaVencimiento: null }];
    expect(campos(() => validarElaboracion(dilucion({ consumos: sinVencimiento })))).toEqual(["fechaVencimiento"]);
    expect(validarElaboracion(dilucion({ consumos: sinVencimiento, drogaProducidaRequiereVencimiento: false })).fechaVencimiento).toBeNull();
  });
});

describe("elaboracion-lote -- consumos", () => {
  it("refuses an expired lot, a repeated lot, a quantity <= 0 and more than what is available", () => {
    expect(campos(() => validarElaboracion(dilucion({ consumos: [consumo({ fechaVencimiento: "2026-10-28" }), LACTOSA] })))).toEqual(["cantidad_p-x"]);
    expect(campos(() => validarElaboracion(dilucion({ consumos: [consumo({}), consumo({})] })))).toEqual(["cantidad_p-x"]);
    expect(campos(() => validarElaboracion(dilucion({ consumos: [consumo({ cantidad: "0" }), LACTOSA] })))).toEqual(["cantidad_p-x"]);
    expect(campos(() => validarElaboracion(dilucion({ consumos: [consumo({ cantidad: "11" }), LACTOSA] })))).toEqual(["cantidad_p-x"]);
  });

  it("refuses no consumos and a cantidad producida <= 0", () => {
    expect(campos(() => validarElaboracion(dilucion({ consumos: [] })))).toEqual(["componentes"]);
    expect(campos(() => validarElaboracion(dilucion({ cantidadProducida: "0" })))).toEqual(["cantidadProducida"]);
  });
});

describe("formula -- EL3 / INV-EL5", () => {
  const JARABE: ValidarFormulaInput = {
    drogaId: "jarabe",
    cantidadReferencia: "100",
    componentes: [
      { drogaId: "azucar", drogaNombre: "Azúcar", cantidad: "85" },
      { drogaId: "agua", drogaNombre: "Agua purificada", cantidad: "46" },
    ],
    drogasConFormula: new Set(),
    esComponenteDe: [],
  };

  it("scales the fórmula: 100 ml with 85 g of azúcar -> 850 g for 1000 ml", () => {
    const escalada = escalarFormula(JARABE, "1000");
    expect(escalada.map((c) => [c.drogaId, c.cantidad.toString()])).toEqual([["azucar", "850"], ["agua", "460"]]);
  });

  it("accepts a valid fórmula", () => {
    expect(() => validarFormula(JARABE)).not.toThrow();
  });

  it("refuses itself, a repeated component, a component with its own fórmula and a droga that is a component", () => {
    const conComponente = (drogaId: string, drogaNombre = "C") => ({ ...JARABE, componentes: [...JARABE.componentes, { drogaId, drogaNombre, cantidad: "1" }] });
    expect(campos(() => validarFormula(conComponente("jarabe")))).toEqual(["componente_jarabe"]);
    expect(campos(() => validarFormula(conComponente("azucar")))).toEqual(["componente_azucar"]);
    expect(campos(() => validarFormula({ ...conComponente("base"), drogasConFormula: new Set(["base"]) }))).toEqual(["componente_base"]);
    expect(campos(() => validarFormula({ ...JARABE, esComponenteDe: ["Crema base"] }))).toEqual(["componentes"]);
  });

  it("refuses no components and a cantidad de referencia <= 0", () => {
    expect(campos(() => validarFormula({ ...JARABE, componentes: [] }))).toEqual(["componentes"]);
    expect(campos(() => validarFormula({ ...JARABE, cantidadReferencia: "0" }))).toEqual(["cantidadReferencia"]);
  });
});

describe("costo-desde-formula -- R38 / R27", () => {
  const FORMULA = { cantidadReferencia: "100", componentes: [{ drogaId: "azucar", drogaNombre: "Azúcar", cantidad: "85" }] };

  it("jarabe simple: 85 g of azúcar at $2/g per 100 ml -> $1,70/ml (and with IVA)", () => {
    const resultado = costoDesdeFormula(FORMULA, new Map([["azucar", { costoUnitario: "2", costoUnitarioConIva: "2.42" }]]));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.costoUnitario.toString()).toBe("1.7");
    expect(resultado.costoUnitarioConIva.toString()).toBe("2.057");
  });

  it("no price when a component has no costo de proveedor, naming the component", () => {
    expect(costoDesdeFormula(FORMULA, new Map())).toEqual({ ok: false, sinCosto: ["Azúcar"] });
  });

  it("no price for a fórmula without components", () => {
    expect(costoDesdeFormula({ cantidadReferencia: "100", componentes: [] }, new Map())).toEqual({ ok: false, sinCosto: [] });
  });
});

describe("pesada-real -- P13 dose below the balance", () => {
  const BALANZA = dec("0.001");

  it("prefills the EXACT esperada below one division (rounding would give 0)", () => {
    expect(bajoLaBalanza("0.00015", BALANZA)).toBe(true);
    expect(sugerenciaPesadaReal("0.00015", BALANZA).toString()).toBe("0.00015");
  });

  it("rounds to the balance from one division up, and never applies off the balance", () => {
    expect(bajoLaBalanza("0.001", BALANZA)).toBe(false);
    expect(sugerenciaPesadaReal("0.0455", BALANZA).toString()).toBe("0.046");
    expect(bajoLaBalanza("0.00015", null)).toBe(false);
    expect(sugerenciaPesadaReal("0.00015", null).toString()).toBe("0.00015");
  });
});

describe("elaboracion-lote -- prefijoLoteElaborado and codigoLoteElaborado (EL9)", () => {
  it("formats the tipo's prefix and the next sequence number", () => {
    expect(prefijoLoteElaborado("DILUCION", "2026-10-29")).toBe("DIL-20261029-");
    expect(prefijoLoteElaborado("FORMULA", "2026-10-29")).toBe("ELA-20261029-");
    expect(codigoLoteElaborado("DILUCION", "2026-10-29", 0)).toBe("DIL-20261029-1");
    expect(codigoLoteElaborado("FORMULA", "2026-10-29", 4)).toBe("ELA-20261029-5");
  });
});

describe("calcular-cotizacion -- R38 / R27 formula pricing", () => {
  const GRAMO = { factorABase: "1", tipoMagnitud: "MASA" };
  const REGLAS: ReglasPrecio = { precioMinimo: "0", tramos: [{ costoHasta: null, margen: "0" }] };

  const costoFormula: CostoFormulaCosteo = {
    cantidadReferencia: "100",
    costoUnitario: "1.7",
    costoUnitarioConIva: "2.057",
    componentes: [
      { drogaNombre: "Azúcar", cantidad: "85", unidadSimbolo: "g", proveedorNombre: "Prov A", costoUnitarioConIva: "2.42" },
    ],
  };

  const costoProveedor: CostoProveedorCosteo = {
    costoProveedorId: "cp-1",
    proveedorId: "prov-1",
    proveedorNombre: "Prov Directo",
    precioInformado: "5000",
    unidadPrecioSimbolo: "kg",
    costoUnitario: "5",
    alicuotaIva: "21",
    precioInformadoConIva: "6050",
    costoUnitarioConIva: "6.05",
    fechaPrecio: "2026-10-01",
  };

  function linea(overrides: Partial<LineaCosteoInput> = {}): LineaCosteoInput {
    return {
      drogaId: "jarabe",
      drogaNombre: "Jarabe simple",
      unidadSimbolo: "g",
      unidad: GRAMO,
      unidadStock: GRAMO,
      cantidadAPesar: "10",
      esEnraseManual: false,
      orden: 0,
      ...overrides,
    };
  }

  it("A FORMULA línea has fuente 'FORMULA', costoFormula in snapshot, subtotal = qty x costoUnitario, subtotalConIva = qty x costoUnitarioConIva, and no alicuotaIva", () => {
    const cotizacion = calcularCotizacion([linea({ costoFormula })], () => [], JORNADA, REGLAS);
    expect(cotizacion.drogasSinPrecio).toEqual([]);
    expect(cotizacion.detalle.lineas).toHaveLength(1);
    const l = cotizacion.detalle.lineas[0]!;
    expect(l.fuente).toBe("FORMULA");
    expect(l.costoFormula).toEqual(costoFormula);
    expect(l.subtotal).toBe("17");
    expect(l.subtotalConIva).toBe("20.57");
    expect(l.alicuotaIva).toBeUndefined();
  });

  it("costoProveedor wins over costoFormula", () => {
    const cotizacion = calcularCotizacion([linea({ costoProveedor, costoFormula })], () => [], JORNADA, REGLAS);
    const l = cotizacion.detalle.lineas[0]!;
    expect(l.fuente).toBe("PROVEEDOR");
    expect(l.subtotal).toBe("50");
    expect(l.costoProveedor).toBeDefined();
    expect(l.costoFormula).toBeUndefined();
  });

  it("with neither, componentesSinCosto puts 'X (componente de Y)' in drogasSinPrecio; without it, the droga's own name", () => {
    const conComponentes = calcularCotizacion(
      [linea({ costoProveedor: null, costoFormula: null, componentesSinCosto: ["Azúcar", "Agua"] })],
      () => [],
      JORNADA,
      REGLAS,
    );
    expect(conComponentes.drogasSinPrecio).toEqual([
      "Azúcar (componente de Jarabe simple)",
      "Agua (componente de Jarabe simple)",
    ]);

    const sinComponentes = calcularCotizacion(
      [linea({ costoProveedor: null, costoFormula: null })],
      () => [],
      JORNADA,
      REGLAS,
    );
    expect(sinComponentes.drogasSinPrecio).toEqual(["Jarabe simple"]);
  });

  it("leerDetalleCotizacion returns costoFormula only for FORMULA", () => {
    const cotFormula = calcularCotizacion([linea({ costoFormula })], () => [], JORNADA, REGLAS);
    const leidoFormula = leerDetalleCotizacion(cotFormula.detalle);
    expect(leidoFormula.lineas[0]!.fuente).toBe("FORMULA");
    expect(leidoFormula.lineas[0]!.costoFormula).toEqual(costoFormula);
    expect(leidoFormula.lineas[0]!.costoProveedor).toBeNull();

    const cotProv = calcularCotizacion([linea({ costoProveedor })], () => [], JORNADA, REGLAS);
    const leidoProv = leerDetalleCotizacion(cotProv.detalle);
    expect(leidoProv.lineas[0]!.fuente).toBe("PROVEEDOR");
    expect(leidoProv.lineas[0]!.costoFormula).toBeNull();
    expect(leidoProv.lineas[0]!.costoProveedor).toBeDefined();
  });
});

describe("presupuesto -- FORMULA líneas", () => {
  const GRAMO = { factorABase: "1", tipoMagnitud: "MASA" };
  const REGLAS: ReglasPrecio = { precioMinimo: "0", tramos: [{ costoHasta: null, margen: "0" }] };

  it("FORMULA líneas produce fuentes, even with no PROVEEDOR línea", () => {
    const costoFormula: CostoFormulaCosteo = {
      cantidadReferencia: "100",
      costoUnitario: "1.7",
      costoUnitarioConIva: "2.057",
      componentes: [
        { drogaNombre: "Azúcar", cantidad: "85", unidadSimbolo: "g", proveedorNombre: "Prov A", costoUnitarioConIva: "2.42" },
      ],
    };
    const lineaFormula: LineaCosteoInput = {
      drogaId: "jarabe",
      drogaNombre: "Jarabe simple",
      unidadSimbolo: "g",
      unidad: GRAMO,
      unidadStock: GRAMO,
      cantidadAPesar: "10",
      esEnraseManual: false,
      orden: 0,
      costoFormula,
    };
    const cotizacion = calcularCotizacion([lineaFormula], () => [], JORNADA, REGLAS);
    const item = presupuestoItemDesdeCotizacion(1, cotizacion);
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.fuentes).toBeDefined();
    expect(item.fuentes).toEqual([
      { drogaNombre: "Jarabe simple", fuente: "FORMULA" },
    ]);
  });
});

describe("confirmar-form -- pesadaDeLinea P13", () => {
  const GRAMO = { factorABase: "1", tipoMagnitud: "MASA" };
  const lineaBase: LineaPantalla = {
    id: "l-1",
    drogaId: "d-x",
    drogaNombre: "Droga X",
    unidad: GRAMO,
    unidadStock: { ...GRAMO, id: "u-g", simbolo: "g" },
    unidadMedidaId: "u-g",
    unidadSimbolo: "g",
    cantidadAPesar: "0.00015",
    esEnraseManual: false,
    partidasElegibles: [],
    propuesta: null,
    stockInsuficiente: false,
    faltante: null,
    requiereMotivo: false,
    bajoLaBalanza: true,
    orden: 1,
  };

  const datos: DatosConfirmacion = {
    fichaTecnicaId: "f-1",
    jornadaActual: JORNADA,
    jornadaCerrada: false,
    diasAlertaVencimiento: 30,
    mesesVencimientoPreparado: 1,
    lineas: [],
    unidades: [],
    pesada: { precisionBalanza: "0.001", toleranciaPorcentaje: "5" },
    dts: [],
  };

  it("P13 scenario (0.001 g balance, 0.00015 g expected from a 100 % lot): sugerida '0,15' mg, bajoLaBalanza true", () => {
    const planPuro = {
      ok: true as const,
      totalFisico: "0.00015",
      requiereMotivo: false,
      partes: [{ partidaId: "p-100", cantidad: "0.00015" }],
    };
    const resultado = pesadaDeLinea(lineaBase, planPuro, undefined, datos);
    expect(resultado).not.toBeNull();
    expect(resultado!.sugerida).toBe("0,15");
    expect(resultado!.bajoLaBalanza).toBe(true);
  });

  it("With a 0.1 % dilución lot: a normal rounded sugerida, bajoLaBalanza false", () => {
    const planDiluido = {
      ok: true as const,
      totalFisico: "0.15",
      requiereMotivo: false,
      partes: [{ partidaId: "p-dil", cantidad: "0.15" }],
    };
    const resultado = pesadaDeLinea(lineaBase, planDiluido, undefined, datos);
    expect(resultado).not.toBeNull();
    expect(resultado!.sugerida).toBe("150");
    expect(resultado!.bajoLaBalanza).toBe(false);
  });
});
