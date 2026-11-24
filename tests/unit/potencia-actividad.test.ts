import { describe, it, expect } from "vitest";
import {
  activoDesdeFisico,
  factorDePartida,
  fisicoParaActivo,
  proponerRepartoActivo,
  tieneCorreccion,
  type PartidaConPotencia,
} from "@/modules/preparaciones/domain/potencia";

const GRAMO = { factorABase: "1", tipoMagnitud: "MASA" };
const MILIGRAMO = { factorABase: "0.001", tipoMagnitud: "MASA" };

describe("potencia tagged factor (5.1)", () => {
  it("keeps the PORCENTAJE path identical to legacy behavior", () => {
    expect(fisicoParaActivo("10", null).toFixed()).toBe("10");
    expect(fisicoParaActivo("10", { tipo: "PORCENTAJE", valor: "100" }).toFixed()).toBe("10");
    expect(fisicoParaActivo("1", { tipo: "PORCENTAJE", valor: "95" }).toFixed()).toBe("1.0527");
    expect(fisicoParaActivo("1", "95").toFixed()).toBe("1.0527");

    expect(activoDesdeFisico("10", null).toFixed()).toBe("10");
    expect(activoDesdeFisico("10", { tipo: "PORCENTAJE", valor: "95" }).toFixed()).toBe("9.5");
    expect(activoDesdeFisico("10", "95").toFixed()).toBe("9.5");

    expect(tieneCorreccion(null)).toBe(false);
    expect(tieneCorreccion({ tipo: "PORCENTAJE", valor: "100" })).toBe(false);
    expect(tieneCorreccion({ tipo: "PORCENTAJE", valor: "95" })).toBe(true);
  });

  it("computes fisicoParaActivo and activoDesdeFisico for ACTIVIDAD (grams & mg)", () => {
    const factor = { tipo: "ACTIVIDAD" as const, uiPorGramo: "100000" };
    expect(tieneCorreccion(factor)).toBe(true);

    // 50.000 UI / 100.000 UI/g = 0.5 g
    expect(fisicoParaActivo("50000", factor, GRAMO).toFixed()).toBe("0.5");
    // In mg: 0.5 g = 500 mg
    expect(fisicoParaActivo("50000", factor, MILIGRAMO).toFixed()).toBe("500");

    // Non-exact division rounds UP to DECIMALES_PESO_FISICO (4)
    // 1000 / 30000 = 0.033333... -> 0.0334 g
    expect(fisicoParaActivo("1000", { tipo: "ACTIVIDAD", uiPorGramo: "30000" }, GRAMO).toFixed()).toBe("0.0334");

    // Inverse
    expect(activoDesdeFisico("0.5", factor, GRAMO).toFixed()).toBe("50000");
    expect(activoDesdeFisico("500", factor, MILIGRAMO).toFixed()).toBe("50000");
  });

  it("splits 500.000 UI across two UI partidas A (100.000 UI/g, 3 g) and B (40.000 UI/g) (UI6)", () => {
    const partidas: PartidaConPotencia[] = [
      {
        id: "partida-a",
        cantidadDisponible: "3",
        fechaVencimiento: "2027-01-01",
        fechaApertura: null,
        potenciaDeclarada: null,
        actividadDeclarada: "100000",
      },
      {
        id: "partida-b",
        cantidadDisponible: "10",
        fechaVencimiento: "2027-06-01",
        fechaApertura: null,
        potenciaDeclarada: null,
        actividadDeclarada: "40000",
      },
    ];

    const res = proponerRepartoActivo(partidas, "500000", "2026-11-24", GRAMO);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.totalFisico.toFixed()).toBe("8");
      expect(res.lineas).toHaveLength(2);
      expect(res.lineas[0]!.partidaId).toBe("partida-a");
      expect(res.lineas[0]!.cantidad.toFixed()).toBe("3");
      expect(res.lineas[0]!.activo.toFixed()).toBe("300000");
      expect(res.lineas[0]!.potenciaAplicada).toBeNull();
      expect(res.lineas[0]!.actividadAplicada?.toFixed()).toBe("100000");
      expect(res.lineas[1]!.partidaId).toBe("partida-b");
      expect(res.lineas[1]!.cantidad.toFixed()).toBe("5");
      expect(res.lineas[1]!.activo.toFixed()).toBe("200000");
      expect(res.lineas[1]!.potenciaAplicada).toBeNull();
      expect(res.lineas[1]!.actividadAplicada?.toFixed()).toBe("40000");
    }
  });

  it("factorDePartida prioritizes actividadDeclarada when present", () => {
    expect(factorDePartida({ potenciaDeclarada: null, actividadDeclarada: "1000" })).toEqual({
      tipo: "ACTIVIDAD",
      uiPorGramo: "1000",
    });
    expect(factorDePartida({ potenciaDeclarada: "95", actividadDeclarada: null })).toEqual({
      tipo: "PORCENTAJE",
      valor: expect.anything(),
    });
  });
});
