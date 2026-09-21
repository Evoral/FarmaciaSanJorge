import { describe, it, expect } from "vitest";
import { buildSessionCookieOptions, SESSION_COOKIE_NAME } from "@/modules/auth/domain/cookie-policy";

describe("buildSessionCookieOptions", () => {
  it("is httpOnly, sameSite=lax, path=/ regardless of environment", () => {
    for (const env of ["development", "test", "production"]) {
      const options = buildSessionCookieOptions(env);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.path).toBe("/");
    }
  });

  it("secure is true only in production", () => {
    expect(buildSessionCookieOptions("production").secure).toBe(true);
    expect(buildSessionCookieOptions("development").secure).toBe(false);
    expect(buildSessionCookieOptions("test").secure).toBe(false);
    expect(buildSessionCookieOptions("anything-else").secure).toBe(false);
  });
});

describe("SESSION_COOKIE_NAME", () => {
  it("is a stable, non-empty identifier", () => {
    expect(SESSION_COOKIE_NAME).toBe("fsj_session");
  });
});
