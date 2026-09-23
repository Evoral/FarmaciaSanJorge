/**
 * Unit tests for modules/usuarios/domain/roles.ts -- SISTEMA must never be
 * assignable (plan's binding decision: the SISTEMA role and the technical
 * user must never appear in role pickers, user lists or any admin action).
 */
import { describe, it, expect } from "vitest";
import { ROLES_ASIGNABLES, esRolAsignable, ROL_SISTEMA, ROL_LABELS } from "@/modules/usuarios/domain/roles";

describe("ROLES_ASIGNABLES", () => {
  it("contains exactly the 5 assignable roles from plan §6, in no particular guaranteed order but as a fixed set", () => {
    expect(new Set(ROLES_ASIGNABLES)).toEqual(
      new Set(["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"]),
    );
  });

  it("never includes SISTEMA", () => {
    expect(ROLES_ASIGNABLES).not.toContain(ROL_SISTEMA);
  });

  it("every assignable role has a display label", () => {
    for (const rol of ROLES_ASIGNABLES) {
      expect(ROL_LABELS[rol]).toBeTruthy();
    }
  });
});

describe("esRolAsignable", () => {
  it("true for each assignable code", () => {
    for (const rol of ROLES_ASIGNABLES) {
      expect(esRolAsignable(rol)).toBe(true);
    }
  });

  it("false for SISTEMA -- the internal, non-assignable role", () => {
    expect(esRolAsignable("SISTEMA")).toBe(false);
  });

  it("false for an unknown/garbage code", () => {
    expect(esRolAsignable("NO_EXISTE")).toBe(false);
  });
});
