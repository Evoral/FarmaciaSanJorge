/**
 * Unit tests for `modules/auth/application/reautenticar.ts`'s PIN branch
 * (PIN re-auth feature, user decision 2026-09-23) -- everything I/O is
 * mocked, same style as tests/unit/stock-co-firma.test.ts's
 * `verificarCoFirmaDt` suite (another `defineCommand` whose failed-attempt
 * counter must survive a "rejected" outcome, i.e. the handler must never
 * throw for an expected wrong-credential result).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  // Resolves the same fixed `session` below -- lets the plain
  // `reautenticar()` wrapper (which calls execute() with no injected
  // session) be exercised directly, in addition to every other test here
  // which injects the session explicitly via execute(input, { session }).
  requireSession: vi.fn(async () => session),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

const loadUsuarioParaPasswordMock = vi.fn();
const loadPinEstadoMock = vi.fn();
const resetPinLockoutMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const recordPinFailureMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadUsuarioParaPassword: (...args: unknown[]) => loadUsuarioParaPasswordMock(...args),
  loadPinEstado: (...args: unknown[]) => loadPinEstadoMock(...args),
  resetPinLockout: (...args: unknown[]) => resetPinLockoutMock(...args),
  recordPinFailure: (...args: unknown[]) => recordPinFailureMock(...args),
}));

const marcarReautenticadaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  marcarReautenticada: (...args: unknown[]) => marcarReautenticadaMock(...args),
}));

const { reautenticarCommand, reautenticar } = await import("@/modules/auth/application/reautenticar");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-2222-2222-222222222222";

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["auth.login"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: null,
};

function execute(input: { password: string } | { pin: string }) {
  return reautenticarCommand.execute(input, { session });
}

beforeEach(() => {
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  loadUsuarioParaPasswordMock.mockReset();
  loadPinEstadoMock.mockReset();
  resetPinLockoutMock.mockClear();
  recordPinFailureMock.mockClear();
  marcarReautenticadaMock.mockClear();
});

describe("reautenticar: PIN branch", () => {
  it("no PIN configured -> rejected, no counter write", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: null, pinBloqueado: false, pinIntentosFallidos: 0 });
    const result = await execute({ pin: "482913" });
    expect(result).toEqual({ ok: false, message: "No tenés un PIN configurado. Usá tu contraseña." });
    expect(recordPinFailureMock).not.toHaveBeenCalled();
  });

  it("blocked PIN -> rejected immediately, even with a matching PIN, no further counter write", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: true, pinIntentosFallidos: 5 });
    verifyPasswordMock.mockResolvedValue(true);
    const result = await execute({ pin: "482913" });
    expect(result).toEqual({ ok: false, message: "El PIN está bloqueado. Reautenticate con tu contraseña." });
    expect(recordPinFailureMock).not.toHaveBeenCalled();
  });

  it("wrong PIN below the threshold -> rejected, counter incremented, not yet blocked, not audited", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 2 });
    verifyPasswordMock.mockResolvedValue(false);
    const result = await execute({ pin: "000000" });
    expect(result).toEqual({ ok: false, message: "El PIN no es correcto." });
    expect(recordPinFailureMock).toHaveBeenCalledWith(expect.anything(), USUARIO_ID, { pinIntentosFallidos: 3, pinBloqueado: false });
  });

  it("the 5th consecutive wrong PIN blocks it (AUTH_POLICY.maxFailedPinAttempts)", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 4 });
    verifyPasswordMock.mockResolvedValue(false);
    const result = await execute({ pin: "000000" });
    expect(result).toEqual({ ok: false, message: "El PIN no es correcto." });
    expect(recordPinFailureMock).toHaveBeenCalledWith(expect.anything(), USUARIO_ID, { pinIntentosFallidos: 5, pinBloqueado: true });
  });

  it("failed PIN attempts never touch the password lockout (no login repository call exists in this module at all)", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 0 });
    verifyPasswordMock.mockResolvedValue(false);
    await execute({ pin: "000000" });
    expect(loadUsuarioParaPasswordMock).not.toHaveBeenCalled();
  });

  it("correct PIN -> accepted, marks reautenticada, resets the PIN lockout", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 3 });
    verifyPasswordMock.mockResolvedValue(true);
    const result = await execute({ pin: "482913" });
    expect(result).toMatchObject({ ok: true });
    expect(marcarReautenticadaMock).toHaveBeenCalled();
    expect(resetPinLockoutMock).toHaveBeenCalledWith(expect.anything(), USUARIO_ID);
  });

  it("reautenticar() (the public, throwing wrapper) converts a wrong-PIN {ok:false} result into a thrown DomainError", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 0 });
    verifyPasswordMock.mockResolvedValue(false);
    await expect(reautenticar({ pin: "000000" })).rejects.toThrow("El PIN no es correcto.");
  });

  it("reautenticar() (the public, throwing wrapper) resolves normally on a correct PIN", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 0 });
    verifyPasswordMock.mockResolvedValue(true);
    await expect(reautenticar({ pin: "482913" })).resolves.toMatchObject({ reautenticadaEn: expect.any(Date) });
  });
});

describe("reautenticar: password branch also resets/unblocks the PIN on success (task's binding decision)", () => {
  it("a successful password re-auth resets AND unblocks the PIN, regardless of its prior state", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue({ id: USUARIO_ID, email: "u@example.com", passwordHash: "hash", pinHash: "pin-hash" });
    verifyPasswordMock.mockResolvedValue(true);
    const result = await execute({ password: "correct-password" });
    expect(result).toMatchObject({ ok: true });
    expect(resetPinLockoutMock).toHaveBeenCalledWith(expect.anything(), USUARIO_ID);
  });

  it("a wrong password never calls resetPinLockout (no state changes on a rejected password attempt)", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue({ id: USUARIO_ID, email: "u@example.com", passwordHash: "hash", pinHash: null });
    verifyPasswordMock.mockResolvedValue(false);
    const result = await execute({ password: "wrong" });
    expect(result).toEqual({ ok: false, message: "La contraseña no es correcta." });
    expect(resetPinLockoutMock).not.toHaveBeenCalled();
  });

  it("the password branch never reads or writes any pin_* field via the PIN repository functions", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue({ id: USUARIO_ID, email: "u@example.com", passwordHash: "hash", pinHash: null });
    verifyPasswordMock.mockResolvedValue(true);
    await execute({ password: "correct-password" });
    expect(loadPinEstadoMock).not.toHaveBeenCalled();
    expect(recordPinFailureMock).not.toHaveBeenCalled();
  });
});
