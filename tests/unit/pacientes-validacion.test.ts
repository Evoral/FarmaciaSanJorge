/**
 * Unit tests for `modules/pacientes/domain/paciente.ts` (FASE 4 point 4.5):
 * CUIL (optional, AFIP check-digit -- reused from
 * `shared/validation/digito-verificador.ts`, the SAME algorithm
 * `modules/proveedores/domain/proveedor.ts`'s CUIT validation uses) and
 * DNI (optional, 7-8 digits, no check digit).
 *
 * CUIL valid examples below are computed by hand against the AFIP
 * mod-11 algorithm (see `shared/validation/digito-verificador.ts`'s doc
 * comment): multiply the first 10 digits by [5,4,3,2,7,6,5,4,3,2], sum,
 * `verificador = 11 - (sum mod 11)` (11 -> 0). For "20-12345678-6":
 * 2*5+0*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2 = 10+0+3+4+21+24+25+24+21+16 = 148;
 * 148 mod 11 = 5; 11-5 = 6 -- matches the trailing 6. The SAME 3 real
 * examples `tests/unit/proveedores-validacion.test.ts` uses for CUIT are
 * reused here for CUIL (identical algorithm, just a different entity
 * attached to the 11-digit number).
 */
import { describe, it, expect } from "vitest";
import { cuilOpcional, dniOpcional } from "@/modules/pacientes/domain/paciente";

describe("cuilOpcional (zod schema: optional, format + AFIP check digit)", () => {
  it("empty/omitted input normalizes to null (cuil stays optional)", () => {
    const empty = cuilOpcional.safeParse("");
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data).toBeNull();

    const omitted = cuilOpcional.safeParse(undefined);
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data).toBeNull();
  });

  it("accepts a real, valid CUIL (with or without hyphens) and normalizes to 11 plain digits", () => {
    const dashed = cuilOpcional.safeParse("20-12345678-6");
    expect(dashed.success).toBe(true);
    if (dashed.success) expect(dashed.data).toBe("20123456786");

    const plain = cuilOpcional.safeParse("27-23456789-1");
    expect(plain.success).toBe(true);
    if (plain.success) expect(plain.data).toBe("27234567891");

    const third = cuilOpcional.safeParse("23-11111111-1");
    expect(third.success).toBe(true);
    if (third.success) expect(third.data).toBe("23111111111");
  });

  it("rejects a CUIL whose check digit does not match", () => {
    const result = cuilOpcional.safeParse("20-12345678-9");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.message).toContain("dígito verificador");
  });

  it("rejects malformed input (wrong length)", () => {
    const result = cuilOpcional.safeParse("123");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.message).toContain("11 dígitos");
  });

  it("a dashed CUIL and its plain-digit equivalent normalize to the IDENTICAL stored value", () => {
    const dashed = cuilOpcional.safeParse("20-12345678-6");
    const plain = cuilOpcional.safeParse("20123456786");
    expect(dashed.success && plain.success).toBe(true);
    if (dashed.success && plain.success) expect(dashed.data).toBe(plain.data);
  });
});

describe("dniOpcional (zod schema: optional, 7-8 digits, no check digit)", () => {
  it("empty/omitted input normalizes to null", () => {
    const empty = dniOpcional.safeParse("");
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data).toBeNull();
  });

  it("accepts an 8-digit DNI", () => {
    const result = dniOpcional.safeParse("30123456");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("30123456");
  });

  it("accepts a 7-digit DNI (historical)", () => {
    const result = dniOpcional.safeParse("4123456");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("4123456");
  });

  it("normalizes a dotted DNI (30.123.456) to plain digits", () => {
    const result = dniOpcional.safeParse("30.123.456");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("30123456");
  });

  it("rejects a DNI with fewer than 7 or more than 8 digits", () => {
    const tooShort = dniOpcional.safeParse("123456");
    expect(tooShort.success).toBe(false);

    const tooLong = dniOpcional.safeParse("123456789");
    expect(tooLong.success).toBe(false);
  });
});
