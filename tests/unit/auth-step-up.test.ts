import { describe, it, expect } from "vitest";
import { isReauthRecent, requireRecentReauth } from "@/modules/auth/domain/step-up";
import { StepUpRequiredError, AuthorizationError, AuthenticationError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/modules/auth/domain/session";

const NOW = new Date("2026-01-01T12:00:00Z");

function fakeSession(reautenticadaEn: Date | null): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "a@b.com", nombre: "A", apellido: "B" },
    tenantId: "t1",
    sesionId: "s1",
    permisos: new Set(),
    reautenticadaEn,
  };
}

describe("isReauthRecent", () => {
  it("null reautenticadaEn is never recent", () => {
    expect(isReauthRecent(null, 15, NOW)).toBe(false);
  });

  it("within the window is recent", () => {
    expect(isReauthRecent(new Date(NOW.getTime() - 5 * 60_000), 15, NOW)).toBe(true);
  });

  it("exactly at the window boundary is still recent (inclusive)", () => {
    expect(isReauthRecent(new Date(NOW.getTime() - 15 * 60_000), 15, NOW)).toBe(true);
  });

  it("past the window is not recent", () => {
    expect(isReauthRecent(new Date(NOW.getTime() - 16 * 60_000), 15, NOW)).toBe(false);
  });
});

describe("requireRecentReauth (INV-X02)", () => {
  it("does not throw when reautenticadaEn is within the window", () => {
    const session = fakeSession(new Date(NOW.getTime() - 60_000));
    expect(() => requireRecentReauth(session, 15, NOW)).not.toThrow();
  });

  it("throws StepUpRequiredError when reautenticadaEn is null", () => {
    const session = fakeSession(null);
    expect(() => requireRecentReauth(session, 15, NOW)).toThrow(StepUpRequiredError);
  });

  it("throws StepUpRequiredError when reautenticadaEn is stale", () => {
    const session = fakeSession(new Date(NOW.getTime() - 60 * 60_000));
    expect(() => requireRecentReauth(session, 15, NOW)).toThrow(StepUpRequiredError);
  });

  it("StepUpRequiredError is distinguishable from AuthenticationError/AuthorizationError", () => {
    const session = fakeSession(null);
    let caught: unknown;
    try {
      requireRecentReauth(session, 15, NOW);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StepUpRequiredError);
    expect(caught).not.toBeInstanceOf(AuthenticationError);
    expect(caught).not.toBeInstanceOf(AuthorizationError);
    expect((caught as StepUpRequiredError).code).toBe("STEP_UP_REQUIRED");
  });
});
