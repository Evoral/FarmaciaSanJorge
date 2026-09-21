import { describe, it, expect } from "vitest";
import { decideLogin, isLocked } from "@/modules/auth/domain/login-policy";

const NOW = new Date("2026-01-01T12:00:00Z");

describe("modules/auth/domain/login-policy#decideLogin (FASE 2 point 2.2 decision table)", () => {
  it("unknown email -> UNKNOWN_EMAIL", () => {
    const decision = decideLogin({ found: false, estado: null, bloqueadoHasta: null, passwordMatches: false, now: NOW });
    expect(decision).toBe("UNKNOWN_EMAIL");
  });

  it("unknown email is UNKNOWN_EMAIL even if passwordMatches happens to be true (e.g. a bug elsewhere) -- found always wins first", () => {
    const decision = decideLogin({ found: false, estado: null, bloqueadoHasta: null, passwordMatches: true, now: NOW });
    expect(decision).toBe("UNKNOWN_EMAIL");
  });

  it("found, ACTIVO, wrong password -> WRONG_PASSWORD", () => {
    const decision = decideLogin({ found: true, estado: "ACTIVO", bloqueadoHasta: null, passwordMatches: false, now: NOW });
    expect(decision).toBe("WRONG_PASSWORD");
  });

  it("found, PENDIENTE_ACTIVACION, correct password (n/a in practice, no hash yet) -> INACTIVE", () => {
    const decision = decideLogin({ found: true, estado: "PENDIENTE_ACTIVACION", bloqueadoHasta: null, passwordMatches: true, now: NOW });
    expect(decision).toBe("INACTIVE");
  });

  it("found, SUSPENDIDO, correct password -> INACTIVE (not ACTIVO is rejected regardless of password)", () => {
    const decision = decideLogin({ found: true, estado: "SUSPENDIDO", bloqueadoHasta: null, passwordMatches: true, now: NOW });
    expect(decision).toBe("INACTIVE");
  });

  it("found, BAJA, correct password -> INACTIVE", () => {
    const decision = decideLogin({ found: true, estado: "BAJA", bloqueadoHasta: null, passwordMatches: true, now: NOW });
    expect(decision).toBe("INACTIVE");
  });

  it("found, ACTIVO, currently locked, CORRECT password -> LOCKED (a locked account is rejected even with the right password)", () => {
    const bloqueadoHasta = new Date(NOW.getTime() + 60_000);
    const decision = decideLogin({ found: true, estado: "ACTIVO", bloqueadoHasta, passwordMatches: true, now: NOW });
    expect(decision).toBe("LOCKED");
  });

  it("found, ACTIVO, lock already expired, correct password -> OK (lock in the past no longer applies)", () => {
    const bloqueadoHasta = new Date(NOW.getTime() - 60_000);
    const decision = decideLogin({ found: true, estado: "ACTIVO", bloqueadoHasta, passwordMatches: true, now: NOW });
    expect(decision).toBe("OK");
  });

  it("found, ACTIVO, never locked, correct password -> OK (success)", () => {
    const decision = decideLogin({ found: true, estado: "ACTIVO", bloqueadoHasta: null, passwordMatches: true, now: NOW });
    expect(decision).toBe("OK");
  });
});

describe("isLocked", () => {
  it("null bloqueadoHasta is never locked", () => {
    expect(isLocked(null, NOW)).toBe(false);
  });

  it("a future bloqueadoHasta is locked", () => {
    expect(isLocked(new Date(NOW.getTime() + 1), NOW)).toBe(true);
  });

  it("a past bloqueadoHasta is not locked", () => {
    expect(isLocked(new Date(NOW.getTime() - 1), NOW)).toBe(false);
  });

  it("bloqueadoHasta exactly equal to now is not locked (strict greater-than)", () => {
    expect(isLocked(new Date(NOW.getTime()), NOW)).toBe(false);
  });
});
