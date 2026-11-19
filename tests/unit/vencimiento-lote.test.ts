import { describe, it, expect } from "vitest";
import { fechaFinDeMes, finDeMes } from "@/shared/time/vencimiento-lote";
import { formatVencimientoLote } from "@/shared/format/fecha";
import { fechaVencimientoLote } from "@/shared/validation";

describe("finDeMes (shared/time/vencimiento-lote)", () => {
  it("normalizes YYYY-MM to the last day of that month", () => {
    expect(finDeMes("2026-01")).toBe("2026-01-31");
    expect(finDeMes("2026-04")).toBe("2026-04-30");
    expect(finDeMes("2026-12")).toBe("2026-12-31");
  });

  it("normalizes YYYY-MM-DD to the last day of that month", () => {
    expect(finDeMes("2026-03-01")).toBe("2026-03-31");
    expect(finDeMes("2026-06-15")).toBe("2026-06-30");
    expect(finDeMes("2026-06-30")).toBe("2026-06-30");
  });

  it("handles February in leap and non-leap years", () => {
    expect(finDeMes("2024-02")).toBe("2024-02-29");
    expect(finDeMes("2024-02-10")).toBe("2024-02-29");
    expect(finDeMes("2025-02")).toBe("2025-02-28");
    expect(finDeMes("2000-02")).toBe("2000-02-29");
    expect(finDeMes("1900-02")).toBe("1900-02-28");
  });

  it("returns invalid inputs unchanged", () => {
    expect(finDeMes("")).toBe("");
    expect(finDeMes("abc")).toBe("abc");
    expect(finDeMes("03/2027")).toBe("03/2027");
    expect(finDeMes("2026-00")).toBe("2026-00");
    expect(finDeMes("2026-13")).toBe("2026-13");
  });
});

describe("fechaFinDeMes (shared/time/vencimiento-lote)", () => {
  it("moves a UTC Date to the last day of its month at UTC midnight", () => {
    expect(fechaFinDeMes(new Date("2026-02-01T00:00:00Z")).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(fechaFinDeMes(new Date("2024-02-10T00:00:00Z")).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(fechaFinDeMes(new Date("2026-01-31T00:00:00Z")).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("formatVencimientoLote (shared/format/fecha)", () => {
  it("formats a Date or ISO string as mm/aaaa", () => {
    expect(formatVencimientoLote(new Date("2027-03-31T00:00:00Z"))).toBe("03/2027");
    expect(formatVencimientoLote("2027-03-31")).toBe("03/2027");
    expect(formatVencimientoLote("2027-03")).toBe("03/2027");
  });

  it("returns unexpected strings unchanged", () => {
    expect(formatVencimientoLote("sin fecha")).toBe("sin fecha");
    expect(formatVencimientoLote("03/2027")).toBe("03/2027");
  });
});

describe("fechaVencimientoLote (shared/validation)", () => {
  it("accepts YYYY-MM and YYYY-MM-DD and normalizes both to the month's last day", () => {
    expect(fechaVencimientoLote.parse(" 2027-03 ")).toBe("2027-03-31");
    expect(fechaVencimientoLote.parse("2024-02-10")).toBe("2024-02-29");
    expect(fechaVencimientoLote.parse("2025-02-01")).toBe("2025-02-28");
  });

  it("rejects invalid formats and non-existent months", () => {
    expect(fechaVencimientoLote.safeParse("03/2027").success).toBe(false);
    expect(fechaVencimientoLote.safeParse("2026-00").success).toBe(false);
    expect(fechaVencimientoLote.safeParse("2026-13").success).toBe(false);
    expect(fechaVencimientoLote.safeParse("").success).toBe(false);
  });
});
