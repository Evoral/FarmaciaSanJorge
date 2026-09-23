/**
 * Unit tests for `modules/proveedores/domain/proveedor.ts` (FASE 4 point
 * 4.3): the CUIT check-digit algorithm, with REAL valid and invalid
 * examples (migration 0007's DB check only validates shape -- this is the
 * only place the digit itself is verified, per that migration's header
 * comment and the task's binding decision).
 */
import { describe, it, expect } from "vitest";
import { cuitDigitoVerificadorValido, cuitString, formatCuit } from "@/modules/proveedores/domain/proveedor";

describe("cuitDigitoVerificadorValido", () => {
  it("accepts real, valid CUITs (with and without hyphens)", () => {
    expect(cuitDigitoVerificadorValido("20-12345678-6")).toBe(true);
    expect(cuitDigitoVerificadorValido("20123456786")).toBe(true);
    expect(cuitDigitoVerificadorValido("30-50000000-3")).toBe(true);
    expect(cuitDigitoVerificadorValido("23-11111111-1")).toBe(true);
    expect(cuitDigitoVerificadorValido("27-23456789-1")).toBe(true);
  });

  it("rejects a CUIT whose check digit does not match", () => {
    expect(cuitDigitoVerificadorValido("20-12345678-9")).toBe(false);
    expect(cuitDigitoVerificadorValido("20123456780")).toBe(false);
    expect(cuitDigitoVerificadorValido("30-50000000-0")).toBe(false);
  });

  it("rejects malformed input (wrong length, letters, missing digits)", () => {
    expect(cuitDigitoVerificadorValido("not-a-cuit")).toBe(false);
    expect(cuitDigitoVerificadorValido("20-1234567-6")).toBe(false);
    expect(cuitDigitoVerificadorValido("")).toBe(false);
  });
});

describe("cuitString (zod schema: format + check digit)", () => {
  it("accepts a valid CUIT", () => {
    const result = cuitString.safeParse("20-12345678-6");
    expect(result.success).toBe(true);
  });

  it("rejects a well-formed but check-digit-invalid CUIT with a specific message", () => {
    const result = cuitString.safeParse("20-12345678-9");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain("dígito verificador");
    }
  });

  it("rejects a malformed CUIT with a format message", () => {
    const result = cuitString.safeParse("not-a-cuit");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain("11 dígitos");
    }
  });
});

describe("cuitString normalization (B1: dashed and plain input must produce the SAME stored value)", () => {
  it("normalizes a dashed CUIT to 11 plain digits", () => {
    const result = cuitString.safeParse("20-12345678-6");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("20123456786");
  });

  it("leaves an already-plain 11-digit CUIT unchanged", () => {
    const result = cuitString.safeParse("20123456786");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("20123456786");
  });

  it("B1: a dashed CUIT and its plain-digit equivalent normalize to the IDENTICAL value -- this is what makes the DB's tightened uniqueness (migration 0028) actually catch the duplicate", () => {
    const dashed = cuitString.safeParse("20-12345678-6");
    const plain = cuitString.safeParse("20123456786");
    expect(dashed.success && plain.success).toBe(true);
    if (dashed.success && plain.success) expect(dashed.data).toBe(plain.data);
  });
});

describe("formatCuit (display formatting -- the inverse direction from cuitString's normalization)", () => {
  it("formats a normalized 11-digit CUIT with dashes", () => {
    expect(formatCuit("20123456786")).toBe("20-12345678-6");
  });

  it("returns non-11-digit input unchanged (defensive)", () => {
    expect(formatCuit("abc")).toBe("abc");
  });
});
