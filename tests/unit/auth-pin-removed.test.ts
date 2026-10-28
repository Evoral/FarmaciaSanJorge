/// <reference types="vite/client" />
/**
 * "Eliminar PIN" is gone: with the PIN mandatory for non-sector usuarios,
 * deleting it makes no sense (openspec/specs/contrasena-temporal/spec.md).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

describe("Eliminar PIN removal", () => {
  it("registers no auth.pin.eliminar use case", () => {
    expect(Object.keys(discoveredModules).some((p) => p.includes("/modules/auth/application/"))).toBe(true);

    const names = listRegisteredUseCasesForTests().map((entry) => entry.name);

    expect(names).toContain("auth.pin.configurarObligatorio");
    expect(names).not.toContain("auth.pin.eliminar");
  });

  it("/cuenta server actions no longer expose eliminarPin", () => {
    const source = readFileSync(resolve(__dirname, "../../app/(app)/cuenta/actions.ts"), "utf8");

    expect(source).not.toContain("eliminarPin");
  });
});
