/**
 * Superadmin branch of modules/auth/application/login.ts (openspec/changes/plataforma-superadmin, spec P3).
 * Proves: a superadmin is looked up only when no usuario matched; exactly one argon2 verification per attempt;
 * every rejection returns the same generic message as a usuario's; the wrong-password path counts the failure; the
 * success path opens a platform session and never a tenant transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const resolveLoginByEmailMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  resolveLoginByEmail: (...args: unknown[]) => resolveLoginByEmailMock(...args),
  loadPasosPendientes: async () => [],
  tenantPuedeIniciarSesion: async () => true,
  recordLoginSuccess: async () => undefined,
  recordLoginFailure: async () => 0,
}));
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({ insertSesionInTx: async () => ({ id: "s" }) }));

const resolveSuperadminMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
const iniciarSesionMock = vi.fn(async (...args: unknown[]): Promise<Date> => {
  void args;
  return new Date("2026-11-09T20:00:00Z");
});
const loginFallidoMock = vi.fn(async (...args: unknown[]): Promise<number> => {
  void args;
  return 1;
});
vi.mock("@/modules/auth/infrastructure/superadmin-repository", () => ({
  resolveSuperadminLoginByEmail: (...args: unknown[]) => resolveSuperadminMock(...args),
  iniciarSesionPlataforma: (...args: unknown[]) => iniciarSesionMock(...args),
  registrarLoginFallidoPlataforma: (...args: unknown[]) => loginFallidoMock(...args),
}));
vi.mock("@/shared/audit/request-context", () => ({ getRequestContext: async () => ({ ip: "10.0.0.1", userAgent: "ua", requestId: "req-1" }) }));

const verifyPasswordMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return false;
});
vi.mock("@/modules/auth/domain/password", () => ({ verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args) }));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __tenant: tenantId }));
const withPlatformTransactionMock = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ __platform: true }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
  withPlatformTransaction: (fn: (tx: unknown) => unknown) => withPlatformTransactionMock(fn),
}));

const { login, GENERIC_LOGIN_ERROR } = await import("@/modules/auth/application/login");
const { InvariantViolationError } = await import("@/shared/errors");

const SUPERADMIN = { superadminId: "33333333-3333-3333-3333-333333333333", passwordHash: "sa-hash", estado: "ACTIVO", bloqueadoHasta: null as Date | null };

async function intentar(password = "pw") {
  const p = login("ops@example.com", password, "10.0.0.1", "ua");
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  resolveLoginByEmailMock.mockReset().mockResolvedValue(null);
  resolveSuperadminMock.mockReset().mockResolvedValue({ ...SUPERADMIN });
  iniciarSesionMock.mockClear();
  loginFallidoMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  withTenantTransactionMock.mockClear();
  withPlatformTransactionMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("login: superadmin branch", () => {
  it("correct password opens a platform session, never a tenant transaction", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const result = await intentar();
    expect(result).toMatchObject({ ok: true, tipo: "SUPERADMIN" });
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
    expect(verifyPasswordMock).toHaveBeenCalledWith("sa-hash", "pw");
    expect(iniciarSesionMock).toHaveBeenCalledTimes(1);
    expect(iniciarSesionMock.mock.calls[0]![1]).toBe(SUPERADMIN.superadminId);
    // Only the hash of the token reaches the database, never the raw token.
    const rawToken = (result as { rawToken: string }).rawToken;
    expect(iniciarSesionMock.mock.calls[0]![2]).not.toBe(rawToken);
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
  });

  it("is not looked up when a usuario has the email", async () => {
    resolveLoginByEmailMock.mockResolvedValue({ tenantId: "11111111-1111-1111-1111-111111111111", usuarioId: "u", passwordHash: "h", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null });
    await intentar();
    expect(resolveSuperadminMock).not.toHaveBeenCalled();
  });

  it("wrong password: generic message, failure counted, one argon2 call", async () => {
    const result = await intentar("wrong");
    expect(result).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(loginFallidoMock).toHaveBeenCalledTimes(1);
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
    expect(iniciarSesionMock).not.toHaveBeenCalled();
  });

  it("INACTIVO with the right password: generic message, nothing written", async () => {
    resolveSuperadminMock.mockResolvedValue({ ...SUPERADMIN, estado: "INACTIVO" });
    verifyPasswordMock.mockResolvedValue(true);
    expect(await intentar()).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(iniciarSesionMock).not.toHaveBeenCalled();
    expect(loginFallidoMock).not.toHaveBeenCalled();
  });

  it("locked with the right password: generic message, nothing written", async () => {
    resolveSuperadminMock.mockResolvedValue({ ...SUPERADMIN, bloqueadoHasta: new Date(Date.now() + 60_000) });
    verifyPasswordMock.mockResolvedValue(true);
    expect(await intentar()).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(iniciarSesionMock).not.toHaveBeenCalled();
  });

  it("deactivated between the read and the session (INV-PLAT-AUTH): generic message", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    iniciarSesionMock.mockRejectedValueOnce(new InvariantViolationError("INV-PLAT-AUTH", "INV-PLAT-AUTH: x"));
    expect(await intentar()).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
  });

  it("unknown email in both tables: generic message, one argon2 call against the dummy hash", async () => {
    resolveSuperadminMock.mockResolvedValue(null);
    expect(await intentar()).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(verifyPasswordMock).toHaveBeenCalledWith(null, "pw");
    expect(withPlatformTransactionMock).not.toHaveBeenCalled();
  });
});
