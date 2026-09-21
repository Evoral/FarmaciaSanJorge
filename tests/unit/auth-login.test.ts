/**
 * Unit tests for modules/auth/application/login.ts (FASE 2 point 2.2).
 * Everything I/O (the resolver, the writes, the transaction, the audit
 * write) is mocked -- see tests/unit/usecase.test.ts for the same style --
 * so these tests prove the ORCHESTRATION: which branch writes what, and,
 * most importantly, that the message returned to the caller is IDENTICAL
 * across unknown-email / wrong-password / inactive-user / locked-user, so
 * a caller can never learn which one happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveLoginByEmailMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
const recordLoginSuccessMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
const recordLoginFailureMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  resolveLoginByEmail: (...args: unknown[]) => resolveLoginByEmailMock(...args),
  recordLoginSuccess: (...args: unknown[]) => recordLoginSuccessMock(...args),
  recordLoginFailure: (...args: unknown[]) => recordLoginFailureMock(...args),
}));

const insertSesionInTxMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return { id: "sesion-1" };
});
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  insertSesionInTx: (...args: unknown[]) => insertSesionInTxMock(...args),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return false;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", async () => {
  const actual = await vi.importActual<typeof import("@/shared/audit")>("@/shared/audit");
  return { ...actual, record: (...args: unknown[]) => auditRecordMock(...args) };
});

let lastFakeTx: unknown;
const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => {
  lastFakeTx = { __fakeTx: true, tenantId };
  return fn(lastFakeTx);
});
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

const { login, GENERIC_LOGIN_ERROR } = await import("@/modules/auth/application/login");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  resolveLoginByEmailMock.mockReset();
  recordLoginSuccessMock.mockClear();
  recordLoginFailureMock.mockClear();
  insertSesionInTxMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  auditRecordMock.mockClear();
  withTenantTransactionMock.mockClear();
});

describe("login: error-message uniformity (FASE 2 point 2.2 -- no enumeration vector)", () => {
  it("unknown email returns the generic message", async () => {
    resolveLoginByEmailMock.mockResolvedValue(null);
    const result = await login("nobody@example.com", "whatever", null, null);
    expect(result).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
  });

  it("wrong password (known, ACTIVO user) returns the SAME generic message", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(false);
    const result = await login("user@example.com", "wrong", null, null);
    expect(result).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
  });

  it("non-ACTIVO user (correct password) returns the SAME generic message", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "SUSPENDIDO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(true);
    const result = await login("user@example.com", "correct", null, null);
    expect(result).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
  });

  it("locked user (correct password) returns the SAME generic message", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 5,
      bloqueadoHasta: new Date(Date.now() + 60_000),
    });
    verifyPasswordMock.mockResolvedValue(true);
    const result = await login("user@example.com", "correct", null, null);
    expect(result).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
  });
});

describe("login: verifyPassword is ALWAYS called, even for an unknown email (timing defense)", () => {
  it("calls verifyPassword(null, password) for an unknown email", async () => {
    resolveLoginByEmailMock.mockResolvedValue(null);
    await login("nobody@example.com", "whatever", null, null);
    expect(verifyPasswordMock).toHaveBeenCalledWith(null, "whatever");
  });
});

describe("login: success path", () => {
  it("resets intentos_fallidos, stamps ultimo_acceso, and creates a session", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 2,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(true);

    const result = await login("user@example.com", "correct", "1.2.3.4", "test-agent");

    expect(result.ok).toBe(true);
    expect(recordLoginSuccessMock).toHaveBeenCalledWith(lastFakeTx, USUARIO_ID, expect.any(Date));
    expect(insertSesionInTxMock).toHaveBeenCalledWith(
      lastFakeTx,
      expect.objectContaining({ tenantId: TENANT_ID, usuarioId: USUARIO_ID, ip: "1.2.3.4", userAgent: "test-agent" }),
    );
    expect(recordLoginFailureMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("opens the transaction on the RESOLVED tenant, never a client-supplied one", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(true);
    await login("user@example.com", "correct", null, null);
    expect(withTenantTransactionMock).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
  });
});

describe("login: lockout bookkeeping", () => {
  it("increments intentos_fallidos on a wrong password, below the threshold, without locking or auditing", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 1,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(false);

    await login("user@example.com", "wrong", null, null);

    expect(recordLoginFailureMock).toHaveBeenCalledWith(lastFakeTx, USUARIO_ID, { intentosFallidos: 2, bloqueadoHasta: null });
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("locks the account and audits LOGIN_FALLIDO_BLOQUEO once the threshold is reached", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 4, // AUTH_POLICY.maxFailedLoginAttempts is 5 -- the 5th failure locks.
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(false);

    await login("user@example.com", "wrong", null, null);

    expect(recordLoginFailureMock).toHaveBeenCalledWith(
      lastFakeTx,
      USUARIO_ID,
      expect.objectContaining({ intentosFallidos: 5, bloqueadoHasta: expect.any(Date) }),
    );
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    const auditInput = auditRecordMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditInput).toMatchObject({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      entidad: "usuario",
      entidadId: USUARIO_ID,
      accion: "LOGIN_FALLIDO_BLOQUEO",
    });
  });

  it("does NOT increment intentos_fallidos further for an already-locked account", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 5,
      bloqueadoHasta: new Date(Date.now() + 60_000),
    });
    verifyPasswordMock.mockResolvedValue(false);

    await login("user@example.com", "wrong", null, null);

    expect(recordLoginFailureMock).not.toHaveBeenCalled();
  });
});
