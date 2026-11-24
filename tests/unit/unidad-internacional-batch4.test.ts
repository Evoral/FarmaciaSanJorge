import { describe, it, expect } from "vitest";
import { dec } from "@/shared/decimal";
import {
  esPartidaCompatibleConLinea,
  partidasCompatiblesConLinea,
  repartirLinea,
  repartirPesadaReal,
  requiereElegirPartida,
} from "@/modules/preparaciones/domain/reparto-linea";
import { precisionDeLinea, unidadDePesada } from "@/modules/preparaciones/domain/pesada-real";
import { avisoExcipienteUi, pesoDeDrogas } from "@/modules/preparaciones/domain/excipiente-por-unidad";
import { calcularCotizacion, type LineaCosteoInput, type PartidaCosteo } from "@/modules/precios/domain/calcular-cotizacion";
import { formatearLineaRp } from "@/modules/preparaciones/domain/etiqueta";
import { formatearFormulaPrescripcion } from "@/modules/preparaciones/domain/formula-prescripcion";
import { planDeLinea, pesadaDeLinea } from "@/modules/preparaciones/ui/confirmar-form";
import type { DatosConfirmacion, LineaPantalla } from "@/modules/preparaciones/application/datos-confirmacion";

const UNIDAD_GRAMO = { id: "u-g", simbolo: "g", factorABase: "1", tipoMagnitud: "MASA" };
const UNIDAD_MG = { id: "u-mg", simbolo: "mg", factorABase: "0.001", tipoMagnitud: "MASA" };
const UNIDAD_UI = { factorABase: "1", tipoMagnitud: "ACTIVIDAD" };

const JORNADA = "2026-11-24";

describe("reparto-linea -- ACTIVIDAD and partida kind (UI6)", () => {
  it("splits an ACTIVIDAD line over two U.I. lots in FEFO order (spec UI6)", () => {
    const partidas = [
      {
        id: "lot-a",
        cantidadDisponible: "3",
        fechaVencimiento: "2027-01-01",
        fechaApertura: "2026-11-01T00:00:00Z",
        potenciaDeclarada: null,
        actividadDeclarada: "100000",
      },
      {
        id: "lot-b",
        cantidadDisponible: "10",
        fechaVencimiento: "2027-06-01",
        fechaApertura: null,
        potenciaDeclarada: null,
        actividadDeclarada: "40000",
      },
    ];

    const res = repartirLinea(partidas, dec("500000"), JORNADA, false, UNIDAD_GRAMO);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.partes).toHaveLength(2);
    expect(res.partes[0]!.partidaId).toBe("lot-a");
    expect(res.partes[0]!.cantidad.toString()).toBe("3");
    expect(res.partes[0]!.actividadAplicada?.toString()).toBe("100000");
    expect(res.partes[0]!.potenciaAplicada).toBeNull();

    expect(res.partes[1]!.partidaId).toBe("lot-b");
    expect(res.partes[1]!.cantidad.toString()).toBe("5");
    expect(res.partes[1]!.actividadAplicada?.toString()).toBe("40000");
    expect(res.partes[1]!.potenciaAplicada).toBeNull();
    expect(res.totalFisico.toString()).toBe("8");
  });

  it("filters candidate partidas by kind (ACTIVIDAD vs MASA)", () => {
    const uiLot = { id: "ui", actividadDeclarada: "100000" };
    const gramLot = { id: "gram", actividadDeclarada: null };
    expect(esPartidaCompatibleConLinea(uiLot, "ACTIVIDAD")).toBe(true);
    expect(esPartidaCompatibleConLinea(gramLot, "ACTIVIDAD")).toBe(false);
    expect(partidasCompatiblesConLinea([uiLot, gramLot], "ACTIVIDAD")).toEqual([uiLot]);
    expect(partidasCompatiblesConLinea([uiLot, gramLot], "MASA")).toEqual([gramLot]);
  });

  it("requires choosing lot when two U.I. lots have different actividadDeclarada, unless manual", () => {
    const lots = [
      { id: "a", cantidadDisponible: "3", fechaVencimiento: null, fechaApertura: null, potenciaDeclarada: null, actividadDeclarada: "100000" },
      { id: "b", cantidadDisponible: "5", fechaVencimiento: null, fechaApertura: null, potenciaDeclarada: null, actividadDeclarada: "40000" },
    ];
    expect(requiereElegirPartida(lots, false)).toBe(true);
    expect(requiereElegirPartida(lots, true)).toBe(false);
  });

  it("records actividadAplicada and null potenciaAplicada in repartirPesadaReal for U.I. lots", () => {
    const lots = [
      { id: "a", cantidadDisponible: "10", fechaVencimiento: null, fechaApertura: null, potenciaDeclarada: null, actividadDeclarada: "100000" },
    ];
    const res = repartirPesadaReal(lots, dec("5.002"), JORNADA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.partes[0]!.cantidad.toString()).toBe("5.002");
    expect(res.partes[0]!.actividadAplicada?.toString()).toBe("100000");
    expect(res.partes[0]!.potenciaAplicada).toBeNull();
  });
});

function makeLineaPantalla(overrides: Partial<LineaPantalla>): LineaPantalla {
  return {
    id: "lin-1",
    drogaId: "droga-1",
    drogaNombre: "Vitamina D3",
    cantidadAPesar: "50000",
    unidadMedidaId: "u-ui",
    unidadSimbolo: "U.I.",
    unidad: UNIDAD_UI,
    unidadStock: UNIDAD_GRAMO,
    esEnraseManual: false,
    cantidadPrescripta: null,
    orden: 0,
    seDosificaEnUi: true,
    partidasElegibles: [],
    propuesta: null,
    stockInsuficiente: false,
    faltante: null,
    requiereMotivo: false,
    bajoLaBalanza: false,
    sinEquivalencia: false,
    ...overrides,
  };
}

describe("equivalenciaManual fallback (UI7)", () => {
  const gramLot = {
    id: "lot-gram",
    lote: "G-1",
    proveedorNombre: "Prov",
    cantidadDisponible: "10",
    unidadSimbolo: "g",
    fechaVencimiento: null,
    reanalizada: false,
    fechaApertura: null,
    potenciaDeclarada: "100",
    actividadDeclarada: null,
    esDilucion: false,
    nombreElaborado: null,
    elaborada: false,
  };

  const uiLot = {
    ...gramLot,
    id: "lot-ui",
    lote: "UI-1",
    cantidadDisponible: "3",
    potenciaDeclarada: null,
    actividadDeclarada: "100000",
  };

  it("Scenario 1: receta in U.I. with only gram lots -> manual quantity over gram lot", () => {
    const linea = makeLineaPantalla({ partidasElegibles: [gramLot], sinEquivalencia: true });
    const plan = planDeLinea(linea, "0.5", ["lot-gram"], JORNADA, true);
    expect(plan).toMatchObject({ ok: true, totalFisico: "0.5" });
  });

  it("Scenario 2: receta in mg with only U.I. lots -> manual quantity over U.I. lot", () => {
    const linea = makeLineaPantalla({
      cantidadAPesar: "1.25",
      unidadMedidaId: "u-mg",
      unidadSimbolo: "mg",
      unidad: UNIDAD_MG,
      partidasElegibles: [uiLot],
      sinEquivalencia: true,
    });
    const plan = planDeLinea(linea, "0.25", ["lot-ui"], JORNADA, true);
    expect(plan).toMatchObject({ ok: true, totalFisico: "0.25" });
  });

  it("Scenario 3: insufficient U.I. lot -> faltante in U.I., and switching whole line to manual works", () => {
    const linea = makeLineaPantalla({
      cantidadAPesar: "500000",
      partidasElegibles: [uiLot], // 3 g * 100.000 U.I./g = 300.000 U.I.
    });
    const planAuto = planDeLinea(linea, undefined, ["lot-ui"], JORNADA, false);
    expect(planAuto).toEqual({ ok: false, faltante: "200000" });

    const planManual = planDeLinea(linea, "2.5", ["lot-ui"], JORNADA, true);
    expect(planManual).toMatchObject({ ok: true, totalFisico: "2.5" });
  });

  it("Scenario 4: unmarked droga with faltante -> no equivalenciaManual", () => {
    const linea = makeLineaPantalla({
      cantidadAPesar: "20",
      unidadMedidaId: "u-g",
      unidadSimbolo: "g",
      unidad: UNIDAD_GRAMO,
      seDosificaEnUi: false,
      partidasElegibles: [gramLot],
    });
    const plan = planDeLinea(linea, undefined, ["lot-gram"], JORNADA, false);
    expect(plan).toEqual({ ok: false, faltante: "10" });
  });
});

describe("pesada-real -- ACTIVIDAD precision", () => {
  it("resolves balance precision from the droga's unidad base for ACTIVIDAD lines", () => {
    const unidad = unidadDePesada(UNIDAD_UI, UNIDAD_GRAMO);
    expect(unidad).toEqual(UNIDAD_GRAMO);
    expect(precisionDeLinea(unidad, "0.001")?.toString()).toBe("0.001");
  });

  it("computes pesadaDeLinea in mg for an ACTIVIDAD line", () => {
    const linea = makeLineaPantalla({ cantidadAPesar: "50000" });
    const datos: DatosConfirmacion = {
      fichaTecnicaId: "f-1",
      jornadaActual: JORNADA,
      jornadaCerrada: false,
      diasAlertaVencimiento: 30,
      mesesVencimientoPreparado: 6,
      lineas: [linea],
      unidades: [],
      pesada: { precisionBalanza: "0.001", toleranciaPorcentaje: "5" },
      dts: [],
    };
    const pesada = pesadaDeLinea(linea, { ok: true, partes: [{ partidaId: "lot-ui", cantidad: "0.5" }], totalFisico: "0.5", requiereMotivo: false }, undefined, datos, false);
    expect(pesada?.esperada.toString()).toBe("500");
    expect(pesada?.sugerida).toBe("500");
  });
});

describe("excipiente -- U.I. notice (UI8)", () => {
  it("returns null pesoDeDrogas and shows the U.I. drug notice", () => {
    const lineas = [{ drogaNombre: "Vitamina D3", cantidadAPesar: "50000", esEnraseManual: false, unidad: UNIDAD_UI }];
    expect(pesoDeDrogas(lineas)).toBeNull();
    expect(avisoExcipienteUi(lineas)).toBe("El peso de Vitamina D3 (U.I.) no está descontado del excipiente.");
  });
});

describe("cotizacion -- ACTIVIDAD line (UI9)", () => {
  const baseLinea: LineaCosteoInput = {
    drogaId: "d-1",
    drogaNombre: "Vitamina D3",
    unidadSimbolo: "U.I.",
    cantidadAPesar: "50000",
    unidad: UNIDAD_UI,
    unidadStock: UNIDAD_GRAMO,
    esEnraseManual: false,
    orden: 0,
    costoProveedor: {
      costoProveedorId: "cp-1",
      proveedorId: "prov-1",
      proveedorNombre: "Prov",
      precioInformado: "100",
      unidadPrecioSimbolo: "g",
      costoUnitario: "100",
      costoUnitarioConIva: "121",
      alicuotaIva: "21",
      fechaPrecio: JORNADA,
    },
  };
  const reglas = { tramos: [{ costoHasta: null, margen: "50" }], precioMinimo: "0" };

  it("costs an ACTIVIDAD line using the first U.I. partida in FEFO order", () => {
    const partidas: PartidaCosteo[] = [
      { id: "p-later", cantidadDisponible: "10", fechaVencimiento: "2027-12-01", fechaApertura: null, costoUnitario: "100", actividadDeclarada: "50000" },
      { id: "p-first", cantidadDisponible: "0.2", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "100", actividadDeclarada: "100000" },
    ];
    const res = calcularCotizacion([baseLinea], () => partidas, JORNADA, reglas);
    expect(res.drogasSinPrecio).toEqual([]);
    // 50.000 U.I. / 100.000 U.I./g (p-first in FEFO) = 0.5 g * 100 = 50
    expect(res.detalle.lineas[0]!.subtotal).toBe("50");
    expect(res.detalle.lineas[0]!.faltante).toBeNull();

    // Only p-first (0.2 g * 100.000 U.I./g = 20.000 U.I.) -> faltante 30.000 U.I.
    const resFaltante = calcularCotizacion([baseLinea], () => [partidas[1]!], JORNADA, reglas);
    expect(resFaltante.detalle.lineas[0]!.faltante).toBe("30000");
  });

  it("flags sinPrecio when no U.I. partida exists without throwing (UI9)", () => {
    const gramOnly: PartidaCosteo[] = [
      { id: "p-gram", cantidadDisponible: "10", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "100", actividadDeclarada: null },
    ];
    const res = calcularCotizacion([baseLinea], () => gramOnly, JORNADA, reglas);
    expect(res.drogasSinPrecio).toEqual(["Vitamina D3"]);
  });
});

describe("etiqueta Rp/ and libro formula in U.I. (UI10)", () => {
  it("prints 'Vitamina D3 50.000 U.I.' in the etiqueta Rp/", () => {
    expect(
      formatearLineaRp({
        drogaNombre: "Vitamina D3",
        cantidad: "50000",
        unidadSimbolo: "U.I.",
        esPsicotropico: false,
      }),
    ).toBe("Vitamina D3 50.000 U.I.");
  });

  it("prints 'Vitamina D3 50.000 U.I.' in the libro recetario formula", () => {
    expect(
      formatearFormulaPrescripcion({
        formaFarmaceutica: "CAPSULA",
        cantidadUnidades: 30,
        fraccionDosisPorUnidad: "1",
        componentes: [
          {
            drogaNombre: "Vitamina D3",
            cantidad: "50000",
            unidadSimbolo: "U.I.",
            modoExpresion: "POR_DOSIS",
            esPrincipioActivo: true,
          },
        ],
        cantidadTotal: null,
        unidadTotalSimbolo: null,
        excipiente: null,
      }),
    ).toBe("Vitamina D3 50.000 U.I. — 30 Cápsulas");
  });
});
