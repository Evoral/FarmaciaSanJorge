import { describe, it, expect } from "vitest";
import { AUTH_POLICY } from "@/shared/auth/policy";

describe("shared/auth/policy", () => {
  it("resolved value: activation credential TTL is 72 hours (plan §9 M00)", () => {
    expect(AUTH_POLICY.activationCredentialTtlHours).toBe(72);
  });

  it("DP-20-pending values are all positive, conservative defaults", () => {
    expect(AUTH_POLICY.sessionIdleMinutes).toBeGreaterThan(0);
    expect(AUTH_POLICY.sessionAbsoluteHours).toBeGreaterThan(0);
    expect(AUTH_POLICY.maxFailedLoginAttempts).toBeGreaterThan(0);
    expect(AUTH_POLICY.lockoutMinutes).toBeGreaterThan(0);
    expect(AUTH_POLICY.minPasswordLength).toBeGreaterThanOrEqual(12);
    expect(AUTH_POLICY.reauthWindowMinutes).toBeGreaterThan(0);
  });

  it("idle timeout is shorter than the absolute session lifetime", () => {
    expect(AUTH_POLICY.sessionIdleMinutes).toBeLessThan(AUTH_POLICY.sessionAbsoluteHours * 60);
  });

  it("is a frozen-shape literal (readonly at the type level)", () => {
    // Runtime sanity check that this is a plain object we can iterate over
    // in tests/docs without surprises -- `as const` gives compile-time
    // readonly, this just confirms the values are primitives (no nested
    // mutable state to worry about).
    for (const value of Object.values(AUTH_POLICY)) {
      expect(typeof value).toBe("number");
    }
  });
});
