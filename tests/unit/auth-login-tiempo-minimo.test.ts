/**
 * Security audit P2-01: minimum time floor for failed login attempts.
 *
 * An unknown email returns immediately after password verification without
 * running a tenant transaction or writing database records, whereas a known
 * account runs a transaction to increment failed attempt counters and/or record
 * audit logs. This timing differential would allow an attacker to enumerate valid
 * user accounts via statistical timing analysis.
 *
 * To mitigate this without introducing noise, login() enforces a fixed minimum
 * execution time (AUTH_POLICY.loginFallidoMinimoMs) on every rejected attempt
 * and thrown error. A fixed floor is used rather than random delay/jitter because
 * random noise statistically averages out over multiple attempts, whereas a
 * deterministic floor guarantees that no rejection path resolves before the floor,
 * neutralizing account enumeration. A successful login never waits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AUTH_POLICY } from "@/shared/auth/policy";

const resolveLoginByEmailMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
const recordLoginSuccessMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
const recordLoginFailureMock = vi.fn(async (...args: unknown[]): Promise<number> => {
  void args;
  return 0;
});
const loadPasosPendientesMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return [];
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  resolveLoginByEmail: (...args: unknown[]) => resolveLoginByEmailMock(...args),
  loadPasosPendientes: (...args: unknown[]) => loadPasosPendientesMock(...args),
  recordLoginSuccess: (...args: unknown[]) => recordLoginSuccessMock(...args),
  recordLoginFailure: (...args: unknown[]) => recordLoginFailureMock(...args),
}));

const insertSesionInTxMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return { id: "sesion-1" };
});
// Superadmin branch (migration 0124): no superadmin matches in these tests.
vi.mock("@/modules/auth/infrastructure/superadmin-repository", () => ({
  resolveSuperadminLoginByEmail: async () => null,
  iniciarSesionPlataforma: async () => new Date(),
  registrarLoginFallidoPlataforma: async () => 0,
}));
vi.mock("@/shared/audit/request-context", () => ({ getRequestContext: async () => ({ ip: null, userAgent: null, requestId: null }) }));

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
  vi.useFakeTimers();
  resolveLoginByEmailMock.mockReset();
  recordLoginSuccessMock.mockClear();
  recordLoginFailureMock.mockClear();
  loadPasosPendientesMock.mockReset().mockResolvedValue([]);
  insertSesionInTxMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  auditRecordMock.mockClear();
  withTenantTransactionMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AUTH_POLICY.loginFallidoMinimoMs time floor (P2-01)", () => {
  it.each([
    [
      "unknown email",
      () => {
        resolveLoginByEmailMock.mockResolvedValue(null);
        verifyPasswordMock.mockResolvedValue(false);
      },
    ],
    [
      "wrong password",
      () => {
        resolveLoginByEmailMock.mockResolvedValue({
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
          passwordHash: "hash",
          estado: "ACTIVO",
          intentosFallidos: 0,
          bloqueadoHasta: null,
        });
        verifyPasswordMock.mockResolvedValue(false);
      },
    ],
    [
      "non-ACTIVO user",
      () => {
        resolveLoginByEmailMock.mockResolvedValue({
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
          passwordHash: "hash",
          estado: "SUSPENDIDO",
          intentosFallidos: 0,
          bloqueadoHasta: null,
        });
        verifyPasswordMock.mockResolvedValue(true);
      },
    ],
    [
      "locked user",
      () => {
        resolveLoginByEmailMock.mockResolvedValue({
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
          passwordHash: "hash",
          estado: "ACTIVO",
          intentosFallidos: 5,
          bloqueadoHasta: new Date(Date.now() + 60_000),
        });
        verifyPasswordMock.mockResolvedValue(true);
      },
    ],
  ])("%s: still pending after advancing loginFallidoMinimoMs - 1, resolved after 1 more ms", async (_scenario, setup) => {
    setup();

    let settled = false;
    let result: unknown;
    const p = login("user@example.com", "password", null, null).then((res) => {
      settled = true;
      result = res;
      return res;
    });

    await vi.advanceTimersByTimeAsync(AUTH_POLICY.loginFallidoMinimoMs - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
    expect(result).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
  });

  it("a successful login resolves without advancing time, and vi.getTimerCount() is 0", async () => {
    resolveLoginByEmailMock.mockResolvedValue({
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(true);

    const result = await login("user@example.com", "correct", null, null);

    expect(result.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("when the inner path throws (resolveLoginByEmail rejects), the rejection surfaces only after the floor", async () => {
    const innerError = new Error("database connection failed");
    resolveLoginByEmailMock.mockRejectedValue(innerError);

    let settled = false;
    let caughtError: unknown;
    const p = login("user@example.com", "password", null, null)
      .then(() => {
        settled = true;
      })
      .catch((err) => {
        settled = true;
        caughtError = err;
      });

    await vi.advanceTimersByTimeAsync(AUTH_POLICY.loginFallidoMinimoMs - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
    expect(caughtError).toBe(innerError);
  });

  it("when the work already took longer than the floor, the rejected login resolves with no extra wait and vi.getTimerCount() is 0", async () => {
    resolveLoginByEmailMock.mockImplementation(async () => {
      vi.advanceTimersByTime(AUTH_POLICY.loginFallidoMinimoMs + 500);
      return null;
    });

    const result = await login("nobody@example.com", "password", null, null);

    expect(result).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(vi.getTimerCount()).toBe(0);
  });
});
