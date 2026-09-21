import { describe, it, expect } from "vitest";
import { PERMISO_CODES, isPermiso } from "@/modules/auth/domain/permisos";

// The exhaustive, bidirectional match against the seeded fsj.permiso
// catalog lives in tests/db/auth-permisos.test.ts (needs a real DB
// connection). This file only checks the shape/sanity of the hand-written
// union itself.
describe("PERMISO_CODES", () => {
  it("is non-empty and has no duplicates", () => {
    expect(PERMISO_CODES.length).toBeGreaterThan(0);
    expect(new Set(PERMISO_CODES).size).toBe(PERMISO_CODES.length);
  });

  it("every code is lowercase, dot-separated, no spaces", () => {
    for (const code of PERMISO_CODES) {
      expect(code).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });

  it("includes the well-known auth.* codes used by the session/login flows", () => {
    expect(PERMISO_CODES).toContain("auth.login");
    expect(PERMISO_CODES).toContain("auth.logout");
    expect(PERMISO_CODES).toContain("auth.password.cambiar");
    expect(PERMISO_CODES).toContain("auth.activar");
  });
});

describe("isPermiso", () => {
  it("true for a real code", () => {
    expect(isPermiso("usuarios.listar")).toBe(true);
  });

  it("false for an unrecognized string", () => {
    expect(isPermiso("not.a.real.permiso")).toBe(false);
  });

  it("false for a near-miss typo of a real code", () => {
    expect(isPermiso("usuarios.lsitar")).toBe(false);
  });
});
