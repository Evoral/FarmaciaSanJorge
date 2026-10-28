/**
 * Unit tests for `modules/drogas/application/contralor-activo.ts`
 * (openspec/specs/existencia-inicial/spec.md R12).
 * Proves that:
 * - contralorActivoParaAltaDrogaQuery requires `drogas.crear`
 * - contralorActivoParaDrogaQuery (edit twin) requires `drogas.editar`
 * - each delegates to `contralorActivoEnTx` with tx and tenantId
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) =>
  fn({ __fakeTx: true, tenantId }),
);
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (tenantId: string, fn: (tx: unknown) => unknown) => withTenantTransactionMock(tenantId, fn),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const contralorActivoEnTxMock = vi.fn(async () => true);
vi.mock("@/modules/libro/application/registrar-apertura-contralor", () => ({
  contralorActivoEnTx: contralorActivoEnTxMock,
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function makeSession(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "user@example.com", nombre: "Nombre", apellido: "Apellido" },
    tenantId: TENANT_ID,
    sesionId: "s-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const {
  contralorActivoParaAltaDrogaQuery,
  contralorActivoParaDrogaQuery,
} = await import("@/modules/drogas/application/contralor-activo");

describe("contralorActivo queries authorization and execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("contralorActivoParaAltaDrogaQuery declares permiso drogas.crear", () => {
    expect(contralorActivoParaAltaDrogaQuery.permiso).toBe("drogas.crear");
  });

  it("contralorActivoParaDrogaQuery declares permiso drogas.editar", () => {
    expect(contralorActivoParaDrogaQuery.permiso).toBe("drogas.editar");
  });

  it("contralorActivoParaAltaDrogaQuery allows a session with drogas.crear and delegates to contralorActivoEnTx", async () => {
    const session = makeSession(["drogas.crear"]);
    contralorActivoEnTxMock.mockResolvedValueOnce(true);

    const result = await contralorActivoParaAltaDrogaQuery.execute({}, { session });

    expect(result).toBe(true);
    expect(contralorActivoEnTxMock).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTx: true, tenantId: TENANT_ID }),
      TENANT_ID,
    );
  });

  it("contralorActivoParaAltaDrogaQuery denies a session holding drogas.editar without drogas.crear", async () => {
    const session = makeSession(["drogas.editar"]);

    await expect(
      contralorActivoParaAltaDrogaQuery.execute({}, { session }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(contralorActivoEnTxMock).not.toHaveBeenCalled();
  });

  it("contralorActivoParaDrogaQuery allows a session with drogas.editar and delegates to contralorActivoEnTx", async () => {
    const session = makeSession(["drogas.editar"]);
    contralorActivoEnTxMock.mockResolvedValueOnce(false);

    const result = await contralorActivoParaDrogaQuery.execute({}, { session });

    expect(result).toBe(false);
    expect(contralorActivoEnTxMock).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTx: true, tenantId: TENANT_ID }),
      TENANT_ID,
    );
  });

  it("contralorActivoParaDrogaQuery denies a session holding drogas.crear without drogas.editar", async () => {
    const session = makeSession(["drogas.crear"]);

    await expect(
      contralorActivoParaDrogaQuery.execute({}, { session }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(contralorActivoEnTxMock).not.toHaveBeenCalled();
  });

  it("denies both queries to a session without either permission", async () => {
    const session = makeSession(["stock.ver"]);

    await expect(
      contralorActivoParaAltaDrogaQuery.execute({}, { session }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      contralorActivoParaDrogaQuery.execute({}, { session }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(contralorActivoEnTxMock).not.toHaveBeenCalled();
  });
});
