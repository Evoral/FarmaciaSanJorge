import { describe, it, expect } from "vitest";
import {
  validatePassword,
  validateTemporaryPassword,
  MAX_PASSWORD_LENGTH,
  AUTH_POLICY,
  PASSWORD_REQUIREMENTS,
  TEMPORARY_PASSWORD_REQUIREMENTS,
} from "@/shared/auth/policy";

describe("shared/auth/policy#validatePassword (FASE 2 points 2.3/2.4)", () => {
  it("rejects a password shorter than the resolved minimum length, with a clear message", () => {
    const errors = validatePassword("short1");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes(String(AUTH_POLICY.minPasswordLength)))).toBe(true);
  });

  it("accepts a password at exactly the minimum length", () => {
    const password = "A" + "a".repeat(AUTH_POLICY.minPasswordLength - 1);
    expect(validatePassword(password)).toEqual([]);
  });

  it("accepts a password well above the minimum length", () => {
    expect(validatePassword("A-perfectly-reasonable-password-123")).toEqual([]);
  });

  it("rejects a password over MAX_PASSWORD_LENGTH", () => {
    const errors = validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1));
    expect(errors.some((e) => e.includes(String(MAX_PASSWORD_LENGTH)))).toBe(true);
  });

  it("rejects an empty password with both the length and empty-string messages", () => {
    const errors = validatePassword("");
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("returns EVERY violated rule, not just the first (lets the UI show one complete message)", () => {
    const errors = validatePassword("   ");
    // Too short (whitespace only, under the minimum) AND effectively empty.
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("derives its errors from PASSWORD_REQUIREMENTS, the same list the UI checklist renders", () => {
    for (const password of ["", "   ", "short1", "a".repeat(AUTH_POLICY.minPasswordLength), "a".repeat(MAX_PASSWORD_LENGTH + 1)]) {
      const expected = PASSWORD_REQUIREMENTS.filter((r) => !r.test(password)).map((r) => r.error);
      expect(validatePassword(password)).toEqual(expected);
    }
  });

  it("requires at least one uppercase letter, including accented ones and Ñ", () => {
    const lower = "a".repeat(AUTH_POLICY.minPasswordLength);
    expect(validatePassword(lower)).toEqual(["Debe tener al menos una letra mayúscula."]);
    expect(validatePassword("Ñ" + lower)).toEqual([]);
    expect(validatePassword("É" + lower)).toEqual([]);
  });

  it("keeps the max-length and not-blank guards internal (enforced, not shown in the checklist)", () => {
    const visible = PASSWORD_REQUIREMENTS.filter((r) => !r.internal).map((r) => r.id);
    expect(visible).toEqual(["min-length", "uppercase"]);
  });
});

describe("shared/auth/policy#validateTemporaryPassword (password typed by the Administrador)", () => {
  it("rejects a password shorter than the temporary minimum, with a clear message", () => {
    expect(validateTemporaryPassword("abc12")).toEqual(["Debe tener al menos 6 caracteres."]);
  });

  it("accepts exactly the temporary minimum, without needing an uppercase letter", () => {
    expect(AUTH_POLICY.minTemporaryPasswordLength).toBe(6);
    expect(validateTemporaryPassword("abc123")).toEqual([]);
  });

  it("keeps the not-blank and max-length guards", () => {
    expect(validateTemporaryPassword("      ")).toEqual(["No puede estar vacía."]);
    expect(validateTemporaryPassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).toEqual([`No puede superar los ${MAX_PASSWORD_LENGTH} caracteres.`]);
  });

  it("derives its errors from TEMPORARY_PASSWORD_REQUIREMENTS and reuses the shared internal guards", () => {
    for (const password of ["", "      ", "abc12", "abc123", "a".repeat(MAX_PASSWORD_LENGTH + 1)]) {
      const expected = TEMPORARY_PASSWORD_REQUIREMENTS.filter((r) => !r.test(password)).map((r) => r.error);
      expect(validateTemporaryPassword(password)).toEqual(expected);
    }
    expect(TEMPORARY_PASSWORD_REQUIREMENTS.filter((r) => !r.internal).map((r) => r.id)).toEqual(["min-length"]);
    for (const id of ["max-length", "not-blank"]) {
      expect(TEMPORARY_PASSWORD_REQUIREMENTS.find((r) => r.id === id)).toBe(PASSWORD_REQUIREMENTS.find((r) => r.id === id));
    }
  });

  it("does not loosen the policy of the password the usuario chooses", () => {
    const errors = validatePassword("abc123");
    expect(errors).toContain("Debe tener al menos 12 caracteres.");
    expect(errors).toContain("Debe tener al menos una letra mayúscula.");
  });
});
