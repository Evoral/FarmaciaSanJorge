/// <reference types="vite/client" />
/**
 * Allowlist of use cases that may run while a mandatory step is pending
 * (openspec/specs/contrasena-temporal/spec.md, CT2/CT3). Every OTHER registered use
 * case, present or future, is blocked by the pipeline behind pending steps;
 * opting in (`permitirPasosPendientes: true`) must be a conscious, reviewed
 * change to this list.
 *
 * Same glob-import approach and module-load mocks as
 * tests/unit/usecase-registry-all-modules.test.ts: importing every
 * modules/<modulo>/application file registers its use cases, and anything
 * with a load-time side effect is mocked.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("next/headers cookies() unexpectedly called -- this test never runs a real request.");
  },
}));

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true })),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- this test never executes a use case.");
  }),
  requireRecentReauth: vi.fn(),
}));

const discoveredModules = import.meta.glob("../../modules/*/application/**/*.ts", { eager: true });

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

describe("use cases allowed to run with pending steps", () => {
  it("is exactly the three auth flows that resolve or leave the pending steps", () => {
    expect(Object.keys(discoveredModules).some((p) => p.includes("/modules/auth/application/"))).toBe(true);

    const allowed = listRegisteredUseCasesForTests()
      .filter((entry) => entry.permitirPasosPendientes === true)
      .map((entry) => entry.name)
      .sort();

    expect(allowed).toEqual(["auth.logout", "auth.password.cambiarTemporal", "auth.pin.configurarObligatorio"]);
  });
});
