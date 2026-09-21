import { describe, it, expect } from "vitest";
import { jornadaDe } from "@/shared/time/jornada";

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
