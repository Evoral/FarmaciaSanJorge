import { describe, it, expect } from "vitest";
import { jornadaDe, inicioDeJornada, rangoDeJornadas } from "@/shared/time/jornada";

// Mendoza is UTC-3 year-round (no DST), so local midnight is 03:00 UTC.
describe("jornadaDe", () => {
  it("02:59 UTC is still the previous jornada in Mendoza (23:59 local)", () => {
    expect(jornadaDe(new Date("2026-01-01T02:59:00Z"))).toBe("2025-12-31");
  });

  it("03:00 UTC is the new jornada in Mendoza (00:00 local)", () => {
    expect(jornadaDe(new Date("2026-01-01T03:00:00Z"))).toBe("2026-01-01");
  });

  it("02:59:59 UTC on Jan 1st is still Dec 31st in Mendoza (year boundary)", () => {
    expect(jornadaDe(new Date("2026-01-01T02:59:59Z"))).toBe("2025-12-31");
  });

  it("03:00:00 UTC on Jan 1st rolls over to the new year in Mendoza", () => {
    expect(jornadaDe(new Date("2026-01-01T03:00:00Z"))).toBe("2026-01-01");
  });

  it("accepts an explicit time zone override", () => {
    // UTC midnight is UTC midnight, trivially.
    expect(jornadaDe(new Date("2026-06-15T00:00:00Z"), "UTC")).toBe("2026-06-15");
  });

  it("defaults to America/Argentina/Mendoza when no time zone is given", () => {
    // Same instant, no explicit tz -> must match the Mendoza-derived value, not UTC's.
    const instant = new Date("2026-06-15T01:00:00Z"); // 22:00 the previous day in Mendoza
    expect(jornadaDe(instant)).toBe("2026-06-14");
    expect(jornadaDe(instant)).not.toBe(jornadaDe(instant, "UTC"));
  });
});

describe("inicioDeJornada", () => {
  it("is local midnight in Mendoza, i.e. 03:00 UTC -- not UTC midnight", () => {
    expect(inicioDeJornada("2026-09-28").toISOString()).toBe("2026-09-28T03:00:00.000Z");
  });

  it("round-trips with jornadaDe at the day boundary", () => {
    const inicio = inicioDeJornada("2026-01-01");
    expect(jornadaDe(inicio)).toBe("2026-01-01");
    expect(jornadaDe(new Date(inicio.getTime() - 1))).toBe("2025-12-31");
  });

  it("honors an explicit time zone, including DST zones", () => {
    expect(inicioDeJornada("2026-06-15", "UTC").toISOString()).toBe("2026-06-15T00:00:00.000Z");
    // Madrid is UTC+2 in summer, UTC+1 in winter.
    expect(inicioDeJornada("2026-07-01", "Europe/Madrid").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(inicioDeJornada("2026-01-15", "Europe/Madrid").toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });
});

describe("rangoDeJornadas", () => {
  it("covers both calendar days completely: [start of desde, start of the day after hasta)", () => {
    const { desde, hastaExclusivo } = rangoDeJornadas("2026-09-01", "2026-09-28");
    expect(desde?.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(hastaExclusivo?.toISOString()).toBe("2026-09-29T03:00:00.000Z");
  });

  it("a same-day range includes 23:59 local of that day (the old UTC-midnight <= filter excluded the whole day)", () => {
    const { desde, hastaExclusivo } = rangoDeJornadas("2026-09-28", "2026-09-28");
    const lateEvening = new Date("2026-09-29T02:59:00Z"); // 23:59 on the 28th in Mendoza
    expect(lateEvening >= desde! && lateEvening < hastaExclusivo!).toBe(true);
  });

  it("rolls hasta over month and year ends", () => {
    expect(rangoDeJornadas(undefined, "2026-12-31").hastaExclusivo?.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(rangoDeJornadas(undefined, "2026-02-28").hastaExclusivo?.toISOString()).toBe("2026-03-01T03:00:00.000Z");
  });

  it("leaves an omitted bound undefined", () => {
    expect(rangoDeJornadas(undefined, undefined)).toEqual({ desde: undefined, hastaExclusivo: undefined });
  });
});
