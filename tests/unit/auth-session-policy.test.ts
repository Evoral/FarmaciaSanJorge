import { describe, it, expect } from "vitest";
import {
  computeAbsoluteExpiry,
  isAbsoluteExpired,
  isIdleExpired,
  checkSessionLifecycle,
} from "@/modules/auth/domain/session-policy";
import { AUTH_POLICY } from "@/shared/auth/policy";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe("computeAbsoluteExpiry", () => {
  it("adds sessionAbsoluteHours to creadaEn", () => {
    const creadaEn = new Date("2026-01-01T00:00:00.000Z");
    const expiraEn = computeAbsoluteExpiry(creadaEn);
    expect(expiraEn.getTime() - creadaEn.getTime()).toBe(AUTH_POLICY.sessionAbsoluteHours * HOUR);
  });
});

describe("isAbsoluteExpired", () => {
  const expiraEn = new Date("2026-01-01T12:00:00.000Z");

  it("false right before expira_en", () => {
    expect(isAbsoluteExpired(expiraEn, new Date(expiraEn.getTime() - 1))).toBe(false);
  });
  it("true exactly at expira_en (>=)", () => {
    expect(isAbsoluteExpired(expiraEn, expiraEn)).toBe(true);
  });
  it("true after expira_en", () => {
    expect(isAbsoluteExpired(expiraEn, new Date(expiraEn.getTime() + 1))).toBe(true);
  });
});

describe("isIdleExpired", () => {
  const ultimoUsoEn = new Date("2026-01-01T00:00:00.000Z");
  const idleMs = AUTH_POLICY.sessionIdleMinutes * MINUTE;

  it("false within the idle window", () => {
    expect(isIdleExpired(ultimoUsoEn, new Date(ultimoUsoEn.getTime() + idleMs))).toBe(false);
  });
  it("true just past the idle window", () => {
    expect(isIdleExpired(ultimoUsoEn, new Date(ultimoUsoEn.getTime() + idleMs + 1))).toBe(true);
  });
});

describe("checkSessionLifecycle", () => {
  const base = {
    expiraEn: new Date("2026-01-02T00:00:00.000Z"),
    ultimoUsoEn: new Date("2026-01-01T00:00:00.000Z"),
    revocadaEn: null as Date | null,
  };

  it("valid session -> null", () => {
    expect(checkSessionLifecycle(base, new Date(base.ultimoUsoEn.getTime() + MINUTE))).toBeNull();
  });

  it("revoked takes precedence over everything else", () => {
    const revoked = { ...base, revocadaEn: new Date("2026-01-01T00:30:00.000Z") };
    expect(checkSessionLifecycle(revoked, new Date(base.ultimoUsoEn.getTime() + MINUTE))).toBe("REVOKED");
  });

  it("reports ABSOLUTE_EXPIRED at the absolute boundary even though the idle window alone would still be fine", () => {
    expect(checkSessionLifecycle(base, base.expiraEn)).toBe("ABSOLUTE_EXPIRED");
  });

  it("reports IDLE_EXPIRED when only the idle window has lapsed", () => {
    const idleMs = AUTH_POLICY.sessionIdleMinutes * MINUTE;
    const now = new Date(base.ultimoUsoEn.getTime() + idleMs + 1);
    expect(checkSessionLifecycle(base, now)).toBe("IDLE_EXPIRED");
  });
});
