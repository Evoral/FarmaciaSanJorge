/**
 * Unit tests for `modules/stock/domain/vencimiento-partida.ts` (docs/specs/reanalisis-partida.md,
 * migration 0074). Pure domain functions and Zod validation schemas -- no I/O, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  sumarDias,
  estadoVencimientoPartida,
  diasHastaVencimiento,
  textoPorVencer,
  rechazoReanalisis,
  rechazoMarcarVencida,
  reanalisisCampos,
  marcarVencidaCampos,
  type PartidaParaVencimiento,
} from "@/modules/stock/domain/vencimiento-partida";

describe("sumarDias", () => {
  it("adds days within the same month", () => {
    expect(sumarDias("2026-06-10", 5)).toBe("2026-06-15");
  });

  it("handles month rollover", () => {
    expect(sumarDias("2026-01-31", 1)).toBe("2026-02-01");
    expect(sumarDias("2026-04-30", 3)).toBe("2026-05-03");
  });

  it("handles year rollover", () => {
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("handles leap years correctly", () => {
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDias("2028-02-28", 2)).toBe("2028-03-01");
    expect(sumarDias("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("handles negative days (subtraction)", () => {
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(sumarDias("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("estadoVencimientoPartida", () => {
  const JORNADA = "2026-06-15";
  const DIAS_ALERTA = 30;

  it("returns NO_VENCE when fechaVencimientoVigente is null (insumo / never expires)", () => {
    expect(estadoVencimientoPartida(null, JORNADA, DIAS_ALERTA)).toBe("NO_VENCE");
  });

  it("returns VENCIDA when vigente date is strictly before jornadaActual (INV-S10)", () => {
    expect(estadoVencimientoPartida("2026-06-14", JORNADA, DIAS_ALERTA)).toBe("VENCIDA");
    expect(estadoVencimientoPartida("2026-01-01", JORNADA, DIAS_ALERTA)).toBe("VENCIDA");
  });

  it("returns POR_VENCER when vigente date equals jornadaActual (not vencida yet)", () => {
    expect(estadoVencimientoPartida(JORNADA, JORNADA, DIAS_ALERTA)).toBe("POR_VENCER");
  });

  it("returns POR_VENCER when vigente date is within the alert window (jornada < date < jornada + diasAlerta)", () => {
    expect(estadoVencimientoPartida("2026-06-20", JORNADA, DIAS_ALERTA)).toBe("POR_VENCER");
    expect(estadoVencimientoPartida("2026-07-01", JORNADA, DIAS_ALERTA)).toBe("POR_VENCER");
  });

  it("returns POR_VENCER at the exact upper boundary (vigente == jornada + diasAlerta)", () => {
    const boundaryDate = sumarDias(JORNADA, DIAS_ALERTA); // "2026-07-15"
    expect(estadoVencimientoPartida(boundaryDate, JORNADA, DIAS_ALERTA)).toBe("POR_VENCER");
  });

  it("returns VIGENTE when vigente date is strictly after jornada + diasAlerta", () => {
    const beyondBoundary = sumarDias(JORNADA, DIAS_ALERTA + 1); // "2026-07-16"
    expect(estadoVencimientoPartida(beyondBoundary, JORNADA, DIAS_ALERTA)).toBe("VIGENTE");
    expect(estadoVencimientoPartida("2027-01-01", JORNADA, DIAS_ALERTA)).toBe("VIGENTE");
  });
});

describe("diasHastaVencimiento", () => {
  const JORNADA = "2026-06-15";

  it("returns 0 when vigente date equals jornada", () => {
    expect(diasHastaVencimiento("2026-06-15", JORNADA)).toBe(0);
  });

  it("returns positive days for future dates", () => {
    expect(diasHastaVencimiento("2026-06-16", JORNADA)).toBe(1);
    expect(diasHastaVencimiento("2026-06-25", JORNADA)).toBe(10);
    expect(diasHastaVencimiento("2027-06-15", JORNADA)).toBe(365);
  });

  it("returns negative days for past dates", () => {
    expect(diasHastaVencimiento("2026-06-14", JORNADA)).toBe(-1);
    expect(diasHastaVencimiento("2026-06-05", JORNADA)).toBe(-10);
  });
});

describe("textoPorVencer", () => {
  const JORNADA = "2026-06-15";

  it("returns 'Vence hoy' when dias <= 0", () => {
    expect(textoPorVencer("2026-06-15", JORNADA)).toBe("Vence hoy");
    expect(textoPorVencer("2026-06-14", JORNADA)).toBe("Vence hoy");
  });

  it("returns 'Vence mañana' when dias === 1", () => {
    expect(textoPorVencer("2026-06-16", JORNADA)).toBe("Vence mañana");
  });

  it("returns 'Vence en N días' when dias > 1", () => {
    expect(textoPorVencer("2026-06-17", JORNADA)).toBe("Vence en 2 días");
    expect(textoPorVencer("2026-06-25", JORNADA)).toBe("Vence en 10 días");
  });
});

describe("rechazoReanalisis", () => {
  const JORNADA = "2026-06-15";

  const partidaValida: PartidaParaVencimiento = {
    drogaClase: "DROGA",
    tieneSaldo: true,
    fechaVencimientoVigente: "2026-06-10",
  };

  it("returns NO_ES_DROGA when drogaClase is not DROGA", () => {
    const partida: PartidaParaVencimiento = { ...partidaValida, drogaClase: "EXCIPIENTE" };
    expect(rechazoReanalisis(partida, "2026-12-31", JORNADA)).toBe("NO_ES_DROGA");
  });

  it("returns NO_ES_DROGA when fechaVencimientoVigente is null (insumo)", () => {
    const partida: PartidaParaVencimiento = { ...partidaValida, fechaVencimientoVigente: null };
    expect(rechazoReanalisis(partida, "2026-12-31", JORNADA)).toBe("NO_ES_DROGA");
  });

  it("returns SIN_SALDO when partida has no remaining balance (saldo 0 is terminal)", () => {
    const partida: PartidaParaVencimiento = { ...partidaValida, tieneSaldo: false };
    expect(rechazoReanalisis(partida, "2026-12-31", JORNADA)).toBe("SIN_SALDO");
  });

  it("returns FECHA_NO_FUTURA when fechaReanalisis is on or before jornada", () => {
    expect(rechazoReanalisis(partidaValida, JORNADA, JORNADA)).toBe("FECHA_NO_FUTURA");
    expect(rechazoReanalisis(partidaValida, "2026-06-14", JORNADA)).toBe("FECHA_NO_FUTURA");
  });

  it("returns null when all conditions are satisfied (valid reanálisis)", () => {
    expect(rechazoReanalisis(partidaValida, "2026-06-16", JORNADA)).toBeNull();
    expect(rechazoReanalisis(partidaValida, "2027-06-15", JORNADA)).toBeNull();
  });

  it("allows reanálisis whether the partida is currently vencida, por vencer or vigente", () => {
    // Vencida
    expect(rechazoReanalisis({ ...partidaValida, fechaVencimientoVigente: "2026-01-01" }, "2027-01-01", JORNADA)).toBeNull();
    // Por vencer
    expect(rechazoReanalisis({ ...partidaValida, fechaVencimientoVigente: "2026-06-20" }, "2027-01-01", JORNADA)).toBeNull();
    // Vigente
    expect(rechazoReanalisis({ ...partidaValida, fechaVencimientoVigente: "2027-01-01" }, "2027-06-01", JORNADA)).toBeNull();
  });
});

describe("rechazoMarcarVencida", () => {
  const JORNADA = "2026-06-15";

  const partidaVencida: PartidaParaVencimiento = {
    drogaClase: "DROGA",
    tieneSaldo: true,
    fechaVencimientoVigente: "2026-06-14",
  };

  it("returns NO_ES_DROGA when drogaClase is not DROGA", () => {
    const partida: PartidaParaVencimiento = { ...partidaVencida, drogaClase: "MATERIAL" };
    expect(rechazoMarcarVencida(partida, JORNADA)).toBe("NO_ES_DROGA");
  });

  it("returns NO_ES_DROGA when fechaVencimientoVigente is null (insumo)", () => {
    const partida: PartidaParaVencimiento = { ...partidaVencida, fechaVencimientoVigente: null };
    expect(rechazoMarcarVencida(partida, JORNADA)).toBe("NO_ES_DROGA");
  });

  it("returns SIN_SALDO when partida has no balance", () => {
    const partida: PartidaParaVencimiento = { ...partidaVencida, tieneSaldo: false };
    expect(rechazoMarcarVencida(partida, JORNADA)).toBe("SIN_SALDO");
  });

  it("returns NO_VENCIDA when fechaVencimientoVigente equals jornadaActual (vence hoy, not yet vencida)", () => {
    const partida: PartidaParaVencimiento = { ...partidaVencida, fechaVencimientoVigente: JORNADA };
    expect(rechazoMarcarVencida(partida, JORNADA)).toBe("NO_VENCIDA");
  });

  it("returns NO_VENCIDA when fechaVencimientoVigente is in the future", () => {
    const partida: PartidaParaVencimiento = { ...partidaVencida, fechaVencimientoVigente: "2026-06-20" };
    expect(rechazoMarcarVencida(partida, JORNADA)).toBe("NO_VENCIDA");
  });

  it("returns null when partida is DROGA, has balance, and fechaVencimientoVigente < jornadaActual", () => {
    expect(rechazoMarcarVencida(partidaVencida, JORNADA)).toBeNull();
  });
});

describe("reanalisisCampos schema", () => {
  it("validates valid input with only required fechaReanalisis", () => {
    const parsed = reanalisisCampos.parse({ fechaReanalisis: "2026-12-31" });
    expect(parsed).toEqual({
      fechaReanalisis: "2026-12-31",
      motivo: undefined,
      respaldo: undefined,
    });
  });

  it("validates valid input with optional motivo and respaldo", () => {
    const parsed = reanalisisCampos.parse({
      fechaReanalisis: "2026-12-31",
      motivo: "Reanálisis de estabilidad anual",
      respaldo: "Protocolo QC-2026-089",
    });
    expect(parsed).toEqual({
      fechaReanalisis: "2026-12-31",
      motivo: "Reanálisis de estabilidad anual",
      respaldo: "Protocolo QC-2026-089",
    });
  });

  it("trims whitespace and transforms empty strings to undefined", () => {
    const parsed = reanalisisCampos.parse({
      fechaReanalisis: "2026-12-31",
      motivo: "   ",
      respaldo: "  Cert-01  ",
    });
    expect(parsed).toEqual({
      fechaReanalisis: "2026-12-31",
      motivo: undefined,
      respaldo: "Cert-01",
    });
  });

  it("rejects invalid or missing fechaReanalisis", () => {
    expect(() => reanalisisCampos.parse({})).toThrow();
    expect(() => reanalisisCampos.parse({ fechaReanalisis: "not-a-date" })).toThrow();
    expect(() => reanalisisCampos.parse({ fechaReanalisis: "2026/12/31" })).toThrow();
    expect(() => reanalisisCampos.parse({ fechaReanalisis: "26-01-01" })).toThrow();
  });

  it("rejects motivo exceeding 500 characters", () => {
    expect(() =>
      reanalisisCampos.parse({
        fechaReanalisis: "2026-12-31",
        motivo: "a".repeat(501),
      }),
    ).toThrow();
  });

  it("rejects respaldo exceeding 200 characters", () => {
    expect(() =>
      reanalisisCampos.parse({
        fechaReanalisis: "2026-12-31",
        respaldo: "b".repeat(201),
      }),
    ).toThrow();
  });
});

describe("marcarVencidaCampos schema", () => {
  it("validates empty input", () => {
    const parsed = marcarVencidaCampos.parse({});
    expect(parsed).toEqual({ observacion: undefined });
  });

  it("validates and trims optional observacion", () => {
    const parsed = marcarVencidaCampos.parse({ observacion: "  Partida descartada por turbidez  " });
    expect(parsed).toEqual({ observacion: "Partida descartada por turbidez" });
  });

  it("transforms whitespace-only observacion to undefined", () => {
    const parsed = marcarVencidaCampos.parse({ observacion: "   " });
    expect(parsed).toEqual({ observacion: undefined });
  });

  it("rejects observacion exceeding 500 characters", () => {
    expect(() => marcarVencidaCampos.parse({ observacion: "x".repeat(501) })).toThrow();
  });
});
