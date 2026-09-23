/**
 * Unit tests for modules/usuarios/domain/reglas-admin.ts (INV-USR-004,
 * INV-USR-005). Pure decision functions -- the DB-side row locking
 * (`FOR UPDATE`) that supplies `idsAdministradoresActivos` is exercised
 * separately in tests/db/usuarios-admin-guard.test.ts.
 */
import { describe, it, expect } from "vitest";
import { esAccionSobreSiMismo, quedariaSinAdministradores } from "@/modules/usuarios/domain/reglas-admin";

describe("esAccionSobreSiMismo (INV-USR-005)", () => {
  it("true when actor and target are the same id", () => {
    expect(esAccionSobreSiMismo("u1", "u1")).toBe(true);
  });

  it("false when they differ", () => {
    expect(esAccionSobreSiMismo("u1", "u2")).toBe(false);
  });
});

describe("quedariaSinAdministradores (INV-USR-004)", () => {
  it("true when the target is the only ACTIVO administrator", () => {
    expect(quedariaSinAdministradores(["u1"], "u1")).toBe(true);
  });

  it("false when there are other ACTIVO administrators besides the target", () => {
    expect(quedariaSinAdministradores(["u1", "u2"], "u1")).toBe(false);
  });

  it("false when the target is not an ACTIVO administrator at all (e.g. FARMACEUTICO being suspended)", () => {
    expect(quedariaSinAdministradores(["u1", "u2"], "u3")).toBe(false);
  });

  it("false when the list is empty and the target is not in it (already no admins -- not this operation's fault, but not a false positive either)", () => {
    expect(quedariaSinAdministradores([], "u1")).toBe(false);
  });

  it("true even when the target appears once in a list of exactly one", () => {
    expect(quedariaSinAdministradores(["only-admin"], "only-admin")).toBe(true);
  });
});
