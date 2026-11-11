/**
 * modules/auth/application/require-superadmin.ts (openspec/specs/plataforma/spec.md P6): the platform guard
 * fails closed -- no cookie, a dead session or ANY error means "not a superadmin".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  // No request scope in a unit test: run the function every time.
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

const readCookieMock = vi.fn(async (): Promise<string | null> => null);
vi.mock("@/modules/auth/infrastructure/cookie-store", () => ({
  readPlataformaCookie: () => readCookieMock(),
  clearPlataformaCookie: async () => undefined,
}));

const validarMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/superadmin-repository", () => ({
  validarSesionPlataforma: (...args: unknown[]) => validarMock(...args),
  cerrarSesionPlataforma: async () => undefined,
}));

vi.mock("@/shared/db/transaction", () => ({
  withPlatformTransaction: async (fn: (tx: unknown) => unknown) => fn({ __platform: true }),
}));
vi.mock("@/shared/logging/logger", () => ({ getLogger: () => ({ error: () => undefined }) }));

const { requireSuperAdmin, superAdminActual } = await import("@/modules/auth/application/require-superadmin");
const { AuthenticationError } = await import("@/shared/errors");
const { hashToken } = await import("@/modules/auth/domain/token");

beforeEach(() => {
  readCookieMock.mockReset().mockResolvedValue(null);
  validarMock.mockReset().mockResolvedValue(null);
});

describe("requireSuperAdmin / superAdminActual", () => {
  it("no cookie: null, the database is not asked", async () => {
    expect(await superAdminActual()).toBeNull();
    expect(validarMock).not.toHaveBeenCalled();
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("dead session: null / AuthenticationError", async () => {
    readCookieMock.mockResolvedValue("raw-token");
    expect(await superAdminActual()).toBeNull();
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("a database error is treated as no session (fails closed)", async () => {
    readCookieMock.mockResolvedValue("raw-token");
    validarMock.mockRejectedValue(new Error("connection refused"));
    expect(await superAdminActual()).toBeNull();
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("live session: the identity plus the token HASH, validated with the hash", async () => {
    readCookieMock.mockResolvedValue("raw-token");
    validarMock.mockResolvedValue({ superadminId: "sa-1", email: "ops@example.com", nombre: "Ops" });
    const sesion = await requireSuperAdmin();
    expect(sesion).toEqual({ superadminId: "sa-1", email: "ops@example.com", nombre: "Ops", tokenHash: hashToken("raw-token") });
    expect(validarMock.mock.calls[0]![1]).toBe(hashToken("raw-token"));
  });
});
