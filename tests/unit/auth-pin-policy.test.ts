/**
 * Unit tests for `modules/auth/domain/pin.ts` (format/triviality) and
 * `modules/auth/domain/pin-reauth-policy.ts` (decision table) -- PIN
 * re-auth feature, user decision 2026-09-23. Same "pure, no mocks" style
 * as tests/unit/auth-login-policy.test.ts.
 */
import { describe, it, expect } from "vitest";
import { isValidPinFormat, isTrivialPin, validatePin } from "@/modules/auth/domain/pin";
import { decidePinReauth } from "@/modules/auth/domain/pin-reauth-policy";

describe("isValidPinFormat", () => {
  it("accepts exactly 4 numeric digits (AUTH_POLICY.pinLength)", () => {
    expect(isValidPinFormat("4829")).toBe(true);
  });

  it("rejects fewer than 4 digits", () => {
    expect(isValidPinFormat("482")).toBe(false);
  });

  it("rejects more than 4 digits -- including the old 6-digit PINs", () => {
    expect(isValidPinFormat("48291")).toBe(false);
    expect(isValidPinFormat("482913")).toBe(false);
  });

  it("rejects non-numeric characters", () => {
    expect(isValidPinFormat("4a29")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidPinFormat("")).toBe(false);
  });
});

describe("isTrivialPin", () => {
  it("all digits equal is trivial", () => {
    expect(isTrivialPin("1111")).toBe(true);
    expect(isTrivialPin("0000")).toBe(true);
  });

  it("ascending sequence is trivial", () => {
    expect(isTrivialPin("1234")).toBe(true);
    expect(isTrivialPin("6789")).toBe(true);
  });

  it("descending sequence is trivial", () => {
    expect(isTrivialPin("4321")).toBe(true);
    expect(isTrivialPin("9876")).toBe(true);
  });

  it("a non-trivial PIN is not flagged", () => {
    expect(isTrivialPin("4829")).toBe(false);
  });

  it("a near-sequence with one digit off is not trivial", () => {
    expect(isTrivialPin("1235")).toBe(false);
  });
});

describe("validatePin", () => {
  it("a well-formed, non-trivial PIN has no errors", () => {
    expect(validatePin("4829")).toEqual([]);
  });

  it("a badly-formatted PIN reports the format error and skips the triviality check", () => {
    const errors = validatePin("482913");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/exactamente 4 dígitos/);
  });

  it("a trivial (all-same-digit) PIN reports the triviality error", () => {
    const errors = validatePin("5555");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/trivial/);
  });

  it("a trivial (sequential) PIN reports the triviality error", () => {
    expect(validatePin("1234")).toHaveLength(1);
    expect(validatePin("4321")).toHaveLength(1);
  });
});

describe("decidePinReauth (pure decision table)", () => {
  it("no PIN configured (pinHash null) -> NO_PIN, regardless of pinMatches", () => {
    expect(decidePinReauth({ pinHash: null, pinBloqueado: false, pinMatches: true })).toBe("NO_PIN");
  });

  it("blocked PIN -> BLOCKED, even with a matching PIN (blocked wins first)", () => {
    expect(decidePinReauth({ pinHash: "hash", pinBloqueado: true, pinMatches: true })).toBe("BLOCKED");
  });

  it("not blocked, wrong PIN -> WRONG_PIN", () => {
    expect(decidePinReauth({ pinHash: "hash", pinBloqueado: false, pinMatches: false })).toBe("WRONG_PIN");
  });

  it("not blocked, matching PIN -> OK", () => {
    expect(decidePinReauth({ pinHash: "hash", pinBloqueado: false, pinMatches: true })).toBe("OK");
  });
});
