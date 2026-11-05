import { describe, it, expect } from "vitest";
import { email, esFechaIso, fechaIso, filtroFechaIso, textoOpcional } from "@/shared/validation";

describe("shared/validation#email", () => {
  it("accepts a well-formed address", () => {
    expect(email.parse("user@example.com")).toBe("user@example.com");
  });

  it("trims and lowercases before validating", () => {
    expect(email.parse("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("rejects a malformed address", () => {
    expect(() => email.parse("not-an-email")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => email.parse("")).toThrow();
  });
});

describe("shared/validation#esFechaIso", () => {
  it("accepts real calendar dates", () => {
    expect(esFechaIso("2026-02-28")).toBe(true);
    expect(esFechaIso("2026-06-15")).toBe(true);
    expect(esFechaIso("2028-02-29")).toBe(true);
  });

  it("rejects other formats and impossible dates", () => {
    expect(esFechaIso("2026-02-29")).toBe(false);
    expect(esFechaIso("2026-02-30")).toBe(false);
    expect(esFechaIso("2026-13-01")).toBe(false);
    expect(esFechaIso("05/11/2026")).toBe(false);
    expect(esFechaIso("2026-6-15")).toBe(false);
    expect(esFechaIso("")).toBe(false);
  });
});

describe("shared/validation#fechaIso", () => {
  it("accepts a real date and trims it", () => {
    expect(fechaIso.parse("2028-02-29")).toBe("2028-02-29");
    expect(fechaIso.parse(" 2026-02-28 ")).toBe("2026-02-28");
  });

  it("refuses a malformed date with the shape message", () => {
    const result = fechaIso.safeParse("05/11/2026");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual(["Debe ser una fecha en formato AAAA-MM-DD."]);
  });

  it("refuses a well formed but non-existent date with the calendar message", () => {
    for (const value of ["2026-02-29", "2026-02-30", "2026-13-01"]) {
      const result = fechaIso.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toBe("Debe ser una fecha que exista en el calendario.");
    }
  });

  it("refuses undefined unless made optional", () => {
    expect(fechaIso.safeParse(undefined).success).toBe(false);
    expect(fechaIso.optional().safeParse(undefined).success).toBe(true);
  });
});

describe("shared/validation#filtroFechaIso", () => {
  it("keeps a valid date", () => {
    expect(filtroFechaIso("2026-02-28")).toBe("2026-02-28");
    expect(filtroFechaIso("2028-02-29")).toBe("2028-02-29");
  });

  it("drops an invalid or missing date", () => {
    expect(filtroFechaIso("2026-02-29")).toBeUndefined();
    expect(filtroFechaIso("2026-02-30")).toBeUndefined();
    expect(filtroFechaIso("2026-13-01")).toBeUndefined();
    expect(filtroFechaIso("05/11/2026")).toBeUndefined();
    expect(filtroFechaIso("")).toBeUndefined();
    expect(filtroFechaIso(undefined)).toBeUndefined();
  });
});

describe("shared/validation#textoOpcional", () => {
  it("turns empty, blank, null and undefined into null", () => {
    const schema = textoOpcional();
    expect(schema.parse("")).toBeNull();
    expect(schema.parse("  ")).toBeNull();
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse(undefined)).toBeNull();
  });

  it("keeps trimmed text", () => {
    expect(textoOpcional().parse("  Cardiología ")).toBe("Cardiología");
  });

  it("enforces the max length when given", () => {
    const schema = textoOpcional(5);
    expect(schema.parse("12345")).toBe("12345");
    expect(schema.safeParse("123456").success).toBe(false);
  });
});
