import { describe, it, expect } from "vitest";
import { validatePassword, MAX_PASSWORD_LENGTH, AUTH_POLICY } from "@/shared/auth/policy";

describe("shared/auth/policy#validatePassword (FASE 2 points 2.3/2.4)", () => {
  it("rejects a password shorter than the resolved minimum length, with a clear message", () => {
    const errors = validatePassword("short1");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes(String(AUTH_POLICY.minPasswordLength)))).toBe(true);
  });

  it("accepts a password at exactly the minimum length", () => {
    const password = "a".repeat(AUTH_POLICY.minPasswordLength);
    expect(validatePassword(password)).toEqual([]);
  });

  it("accepts a password well above the minimum length", () => {
    expect(validatePassword("a-perfectly-reasonable-password-123")).toEqual([]);
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
});
