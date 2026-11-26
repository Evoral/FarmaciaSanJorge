import { describe, it, expect } from "vitest";
import { DomainError, ValidationError } from "@/shared/errors";
import {
  actividadDeclaradaString,
  parsearActividadOValor,
  validarTipoIngresoPartida,
} from "@/modules/stock/domain/partida";
import {
  actividadDeDilucion,
  nombreSugeridoLote,
  validarElaboracion,
  type ConsumoElaboracion,
} from "@/modules/stock/domain/elaboracion-lote";
import { campoFaltanteFila, conflictosGrupo } from "@/modules/stock/domain/existencia-inicial";
import { mapPartidaActividadDbError } from "@/modules/stock/infrastructure/partida-repository";

describe("parsearActividadOValor & actividadDeclaradaString (UI4)", () => {
  it("parses plain positive numbers and certificate expressions into U.I./g", () => {
    const r1 = parsearActividadOValor("100");
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.uiPorGramo.toString()).toBe("100");

    const r2 = parsearActividadOValor("1000 U.I. cada 10 g");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.uiPorGramo.toString()).toBe("100");

    const r3 = parsearActividadOValor("10 g cada 1000 U.I.");
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.uiPorGramo.toString()).toBe("100");

    const r4 = actividadDeclaradaString.safeParse("500 U.I. cada 500 mg");
    expect(r4.success).toBe(true);
    if (r4.success) expect(r4.data.toString()).toBe("1000");
  });

  it("rejects zero, negative, or invalid expressions", () => {
    expect(actividadDeclaradaString.safeParse("0").success).toBe(false);
    expect(actividadDeclaradaString.safeParse("-10").success).toBe(false);
    expect(actividadDeclaradaString.safeParse("").success).toBe(false);
    expect(actividadDeclaradaString.safeParse("abc").success).toBe(false);
  });
});

describe("validarTipoIngresoPartida (UI4 intake rules)", () => {
  it("requires explicit tipoIngreso for a marked droga (no default)", () => {
    expect(() =>
      validarTipoIngresoPartida({ seDosificaEnUi: true, tipoIngreso: undefined }),
    ).toThrowError(ValidationError);

    try {
      validarTipoIngresoPartida({ seDosificaEnUi: true, tipoIngreso: undefined }, (f) => `lineas.0.${f}`);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).fields).toEqual(["lineas.0.tipoIngreso"]);
    }
  });

  it("requires actividadDeclarada and refuses potenciaDeclarada when tipoIngreso is UI", () => {
    expect(() =>
      validarTipoIngresoPartida({ seDosificaEnUi: true, tipoIngreso: "UI", actividadDeclarada: undefined }),
    ).toThrowError(ValidationError);

    expect(() =>
      validarTipoIngresoPartida({
        seDosificaEnUi: true,
        tipoIngreso: "UI",
        actividadDeclarada: "100",
        potenciaDeclarada: "95",
      }),
    ).toThrowError(DomainError);

    expect(() =>
      validarTipoIngresoPartida({
        seDosificaEnUi: true,
        tipoIngreso: "UI",
        actividadDeclarada: "100",
        potenciaDeclarada: null,
      }),
    ).not.toThrow();
  });

  it("accepts GRAMOS for a marked droga without potenciaDeclarada, and refuses actividadDeclarada", () => {
    expect(() =>
      validarTipoIngresoPartida({ seDosificaEnUi: true, tipoIngreso: "GRAMOS", potenciaDeclarada: null }),
    ).not.toThrow();

    expect(() =>
      validarTipoIngresoPartida({
        seDosificaEnUi: true,
        tipoIngreso: "GRAMOS",
        actividadDeclarada: "100",
      }),
    ).toThrowError(ValidationError);
  });

  it("refuses UI or actividadDeclarada on an unmarked droga, and leaves gram intake unchanged", () => {
    expect(() =>
      validarTipoIngresoPartida({ seDosificaEnUi: false, tipoIngreso: "UI", actividadDeclarada: "100" }),
    ).toThrowError(ValidationError);

    expect(() =>
      validarTipoIngresoPartida({ seDosificaEnUi: false, potenciaDeclarada: "98" }),
    ).not.toThrow();
  });
});

describe("existencia-inicial domain with U.I.", () => {
  const drogaUi = { id: "d1", nombre: "Vitamina D3", clase: "DROGA" as const, unidadBaseId: "u-g", seDosificaEnUi: true };
  const drogaGram = { id: "d2", nombre: "Paracetamol", clase: "DROGA" as const, unidadBaseId: "u-g", seDosificaEnUi: false };

  it("rejects both potencia and actividad, or actividad on an unmarked droga", () => {
    const f1 = campoFaltanteFila(
      {
        id: "r1",
        drogaId: "d1",
        lote: "L1",
        fechaVencimiento: "2027-01-01",
        cantidad: "10",
        unidadMedidaId: "u-g",
        potenciaDeclarada: "90",
        actividadDeclarada: "100",
      },
      drogaUi,
    );
    expect(f1?.campo).toBe("actividadDeclarada");

    const f2 = campoFaltanteFila(
      {
        id: "r2",
        drogaId: "d2",
        lote: "L2",
        fechaVencimiento: "2027-01-01",
        cantidad: "10",
        unidadMedidaId: "u-g",
        actividadDeclarada: "100",
      },
      drogaGram,
    );
    expect(f2?.campo).toBe("actividadDeclarada");
  });

  it("detects conflicts between U.I. and gram rows or different actividadDeclarada", () => {
    const c1 = conflictosGrupo([
      { id: "1", drogaId: "d1", lote: "L1", actividadDeclarada: "100" },
      { id: "2", drogaId: "d1", lote: "L1", potenciaDeclarada: "100" },
    ]);
    expect(c1.length).toBeGreaterThan(0);

    const c2 = conflictosGrupo([
      { id: "1", drogaId: "d1", lote: "L1", actividadDeclarada: "100" },
      { id: "2", drogaId: "d1", lote: "L1", actividadDeclarada: "200" },
    ]);
    expect(c2.length).toBeGreaterThan(0);
  });
});

describe("elaboracion-lote U.I. dilution (UI4)", () => {
  const baseConsumoUi: ConsumoElaboracion = {
    partidaId: "p1",
    lote: "VD3-01",
    drogaId: "d-vitd3",
    drogaNombre: "Vitamina D3",
    cantidad: "10",
    cantidadDisponible: "50",
    costoUnitario: "100",
    potenciaDeclarada: null,
    actividadDeclarada: "100000",
    fechaVencimiento: "2027-12-31",
    drogaClase: "DROGA",
  };

  it("dilutes 10 g at 100000 U.I./g to 100 g -> 10000 U.I./g (spec UI4)", () => {
    const res = validarElaboracion({
      tipo: "DILUCION",
      drogaProducidaId: "d-vitd3",
      drogaProducidaRequiereVencimiento: true,
      cantidadProducida: "100",
      consumos: [
        baseConsumoUi,
        {
          partidaId: "p-exc",
          lote: "EXC-01",
          drogaId: "d-exc",
          drogaNombre: "Lactosa",
          cantidad: "90",
          cantidadDisponible: "500",
          costoUnitario: "10",
          potenciaDeclarada: null,
          actividadDeclarada: null,
          fechaVencimiento: null,
          drogaClase: "EXCIPIENTE",
        },
      ],
      jornada: "2026-11-24",
    });

    expect(res.potenciaDeclarada).toBeNull();
    expect(res.actividadDeclarada?.toString()).toBe("10000");
    expect(nombreSugeridoLote("Vitamina D3", res.potenciaDeclarada, res.actividadDeclarada)).toContain("U.I./g");
  });

  it("refuses mixing a U.I. lot and a gram lot of the same droga in one dilution", () => {
    expect(() =>
      validarElaboracion({
        tipo: "DILUCION",
        drogaProducidaId: "d-vitd3",
        drogaProducidaRequiereVencimiento: true,
        cantidadProducida: "100",
        consumos: [
          baseConsumoUi,
          { ...baseConsumoUi, partidaId: "p2", lote: "VD3-GRAM", potenciaDeclarada: "100", actividadDeclarada: null },
        ],
        jornada: "2026-11-24",
      }),
    ).toThrowError(DomainError);
  });

  it("keeps FORMULA lots as gram lots (actividadDeclarada = null, potenciaDeclarada = null)", () => {
    const res = validarElaboracion({
      tipo: "FORMULA",
      drogaProducidaId: "d-formula",
      drogaProducidaRequiereVencimiento: true,
      cantidadProducida: "100",
      consumos: [baseConsumoUi],
      jornada: "2026-11-24",
    });
    expect(res.potenciaDeclarada).toBeNull();
    expect(res.actividadDeclarada).toBeNull();
  });

  it("computes actividadDeDilucion rounding down to 6 decimals", () => {
    const act = actividadDeDilucion([baseConsumoUi], "d-vitd3", "30");
    expect(act.toString()).toBe("33333.333333");
  });
});

describe("mapPartidaActividadDbError", () => {
  it("maps DB CHECK and trigger errors to DomainError with Spanish message and field", () => {
    expect(() =>
      mapPartidaActividadDbError(new Error('violates check constraint "partida_potencia_o_actividad_check"')),
    ).toThrowError(DomainError);

    expect(() =>
      mapPartidaActividadDbError(new Error("partida 1 cannot set actividad_declarada because droga 2 does not have se_dosifica_en_ui")),
    ).toThrowError(DomainError);

    expect(() =>
      mapPartidaActividadDbError(new Error("partida 1 cannot switch between gram lot and U.I. lot after intake")),
    ).toThrowError(DomainError);
  });
});
