import { describe, it, expect } from "vitest";
import { can, authorize } from "@/modules/auth/domain/authorize";
import { AuthorizationError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/modules/auth/domain/session";
import type { Permiso } from "@/modules/auth/domain/permisos";

function fakeSession(permisos: Permiso[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "a@b.com", nombre: "A", apellido: "B" },
    tenantId: "t1",
    sesionId: "s1",
    permisos: new Set(permisos),
    reautenticadaEn: null,
  };
}

describe("can", () => {
  it("true when the permiso is present", () => {
    expect(can(fakeSession(["usuarios.listar"]), "usuarios.listar")).toBe(true);
  });

  it("false when absent", () => {
    expect(can(fakeSession([]), "usuarios.listar")).toBe(false);
  });

  it("never throws (safe for UI hide/show checks)", () => {
    expect(() => can(fakeSession([]), "tenants.crear")).not.toThrow();
  });
});

describe("authorize", () => {
  it("does not throw when the permiso is present", () => {
    expect(() => authorize(fakeSession(["usuarios.crear"]), "usuarios.crear")).not.toThrow();
  });

  it("throws AuthorizationError when absent", () => {
    expect(() => authorize(fakeSession([]), "usuarios.crear")).toThrow(AuthorizationError);
  });

  it("never authorizes a permiso outside the session's set, even a similarly-named one", () => {
    expect(() => authorize(fakeSession(["usuarios.listar"]), "usuarios.crear")).toThrow(AuthorizationError);
  });

  it("an empty permission set is denied for every permiso", () => {
    const session = fakeSession([]);
    expect(() => authorize(session, "auth.login")).toThrow(AuthorizationError);
    expect(() => authorize(session, "auditoria.ver")).toThrow(AuthorizationError);
  });
});
