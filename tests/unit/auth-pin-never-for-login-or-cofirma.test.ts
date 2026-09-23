/**
 * PIN re-auth feature (user decision 2026-09-23) -- binding rule: a PIN is
 * NEVER valid for login, activation, password change, credential reset,
 * or DT co-firma. This is enforced STRUCTURALLY (those modules never read
 * `pin_hash` at all, not by a runtime "reject if this looks like a PIN"
 * check), so these tests prove it the strongest way available to a unit
 * test: the mocked candidate row's `pinHash` property is a getter that
 * THROWS if ever read. If `login()` or `verificarCoFirmaDt()` ever grew a
 * code path that consulted a PIN, these tests would fail with that thrown
 * error instead of the expected result.
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
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called");
  }),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

// --- login() dependencies ---
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

// --- verificarCoFirmaDt() dependencies ---
const resolveDtCandidatoMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
const esDtVigenteHoyMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return true;
});
const recordCoFirmaFailureMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
const recordCoFirmaSuccessMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/stock/infrastructure/co-firma-repository", () => ({
  resolveDtCandidato: (...args: unknown[]) => resolveDtCandidatoMock(...args),
  esDtVigenteHoy: (...args: unknown[]) => esDtVigenteHoyMock(...args),
  recordCoFirmaFailure: (...args: unknown[]) => recordCoFirmaFailureMock(...args),
  recordCoFirmaSuccess: (...args: unknown[]) => recordCoFirmaSuccessMock(...args),
}));

const { login } = await import("@/modules/auth/application/login");
const { verificarCoFirmaDtCommand } = await import("@/modules/stock/application/verificar-co-firma-dt");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-2222-2222-222222222222";
const DT_ID = "33333333-3333-4333-a333-333333333333";

/** A row shaped like a real repository result, but reading `pinHash` throws -- see module doc comment. */
function candidateWithPoisonedPin(extra: Record<string, unknown>): Record<string, unknown> {
  return Object.defineProperty({ ...extra }, "pinHash", {
    enumerable: true,
    get() {
      throw new Error("pin_hash must never be read by login()/verificarCoFirmaDt()");
    },
  });
}

const operadorSession: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "op@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["stock.ajuste.registrar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  resolveLoginByEmailMock.mockReset();
  resolveDtCandidatoMock.mockReset();
  recordCoFirmaFailureMock.mockClear();
});

describe("login() never reads a PIN, even from a candidate row that has one attached", () => {
  it("wrong password is rejected the same way -- pin_hash is never touched", async () => {
    resolveLoginByEmailMock.mockResolvedValue(
      candidateWithPoisonedPin({ tenantId: TENANT_ID, usuarioId: USUARIO_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null }),
    );
    verifyPasswordMock.mockResolvedValue(false);
    // "482913" looks exactly like a valid 6-digit PIN -- login() must treat it as an ordinary wrong password, never consult pin_hash.
    const result = await login("user@example.com", "482913", null, null);
    expect(result.ok).toBe(false);
  });

  it("a correct password logs in without ever touching pin_hash", async () => {
    resolveLoginByEmailMock.mockResolvedValue(
      candidateWithPoisonedPin({ tenantId: TENANT_ID, usuarioId: USUARIO_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null }),
    );
    verifyPasswordMock.mockResolvedValue(true);
    const result = await login("user@example.com", "real-password", null, null);
    expect(result.ok).toBe(true);
  });
});

describe("verificarCoFirmaDt() never reads the DT's PIN, even from a candidate row that has one attached", () => {
  function verificarCoFirmaDt(input: { dtUsuarioId: string; password: string }) {
    return verificarCoFirmaDtCommand.execute(input, { session: operadorSession });
  }

  it("a wrong DT password is rejected without ever touching pin_hash", async () => {
    resolveDtCandidatoMock.mockResolvedValue(
      candidateWithPoisonedPin({ usuarioId: DT_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null }),
    );
    verifyPasswordMock.mockResolvedValue(false);
    // Again: a 6-digit value that could be mistaken for a PIN must be treated as an ordinary wrong password.
    const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "482913" });
    expect(result).toMatchObject({ ok: false });
  });

  it("a correct DT password (and current designation) succeeds without ever touching pin_hash", async () => {
    resolveDtCandidatoMock.mockResolvedValue(
      candidateWithPoisonedPin({ usuarioId: DT_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null }),
    );
    verifyPasswordMock.mockResolvedValue(true);
    const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "real-password" });
    expect(result).toMatchObject({ ok: true, dtUsuarioId: DT_ID });
  });
});
