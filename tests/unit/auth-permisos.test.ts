import { describe, it, expect } from "vitest";
import { PERMISO_CATALOGO, PERMISO_CODES, PERMISOS_DE_ADMINISTRADOR, isPermiso } from "@/modules/auth/domain/permisos";
import { ayudaDePermiso } from "@/modules/usuarios/domain/ayuda-permisos";

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

describe("cotizaciones.costo.ver (migration 0131)", () => {
  it("is present in the permiso catalog with category 'consulta'", () => {
    expect(isPermiso("cotizaciones.costo.ver")).toBe(true);
    expect(PERMISO_CATALOGO["cotizaciones.costo.ver"]).toBe("consulta");
  });

  it("is included in PERMISOS_DE_ADMINISTRADOR (as a non-operativo consulta permiso)", () => {
    expect(PERMISOS_DE_ADMINISTRADOR).toContain("cotizaciones.costo.ver");
  });

  it("has descriptive help text in ayuda-permisos", () => {
    const ayuda = ayudaDePermiso("cotizaciones.costo.ver");
    expect(ayuda).toBeDefined();
    expect(typeof ayuda).toBe("string");
    expect(ayuda!.length).toBeGreaterThan(0);
  });
});
