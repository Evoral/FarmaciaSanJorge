/**
 * Unit tests for `modules/libro/application/verificar-co-firma-dt.ts`
 * (FASE 9, M12 point 9.2). Mirrors tests/unit/stock-co-firma.test.ts's
 * application-half shape (mocked infra/session/transaction) -- the pure
 * decision table (`decideCoFirma`) is already covered there, so this file
 * focuses on this module's OWN wiring: permiso, own repository, generic
 * message.
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

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const operadorSession: AuthenticatedSession = {
  usuario: { id: "u-operador", email: "op@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["libro.anulacion.solicitar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

const resolveDtCandidatoMock = vi.fn();
const esDtVigenteHoyMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const recordCoFirmaFailureMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const recordCoFirmaSuccessMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/modules/libro/infrastructure/co-firma-repository", () => ({
  resolveDtCandidato: (...args: unknown[]) => resolveDtCandidatoMock(...args),
  esDtVigenteHoy: (...args: unknown[]) => esDtVigenteHoyMock(...args),
  recordCoFirmaFailure: (...args: unknown[]) => recordCoFirmaFailureMock(...args),
  recordCoFirmaSuccess: (...args: unknown[]) => recordCoFirmaSuccessMock(...args),
}));

const { verificarCoFirmaDtLibroCommand, CO_FIRMA_LIBRO_GENERIC_ERROR } = await import("@/modules/libro/application/verificar-co-firma-dt");

function verificar(input: { dtUsuarioId: string; password: string }) {
  return verificarCoFirmaDtLibroCommand.execute(input, { session: operadorSession });
}

const DT_ID = "22222222-2222-4222-a222-222222222222";

describe("verificarCoFirmaDtLibro", () => {
  beforeEach(() => {
    resolveDtCandidatoMock.mockReset();
    esDtVigenteHoyMock.mockReset().mockResolvedValue(false);
    verifyPasswordMock.mockReset().mockResolvedValue(true);
    recordCoFirmaFailureMock.mockClear();
    recordCoFirmaSuccessMock.mockClear();
  });

  it("non-DT (found, ACTIVO, correct password, but NOT DT vigente today) -> generic rejection, never leaks the reason", async () => {
    resolveDtCandidatoMock.mockResolvedValue({ usuarioId: DT_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null });
    verifyPasswordMock.mockResolvedValue(true);
    esDtVigenteHoyMock.mockResolvedValue(false);

    const result = await verificar({ dtUsuarioId: DT_ID, password: "correct" });
    expect(result).toEqual({ ok: false, message: CO_FIRMA_LIBRO_GENERIC_ERROR });
    expect(recordCoFirmaFailureMock).not.toHaveBeenCalled();
  });

  it("valid DT vigente -> ok, returns the id (the ONLY id `anularAsiento` will accept as autorizadoPorId)", async () => {
    resolveDtCandidatoMock.mockResolvedValue({ usuarioId: DT_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null });
    verifyPasswordMock.mockResolvedValue(true);
    esDtVigenteHoyMock.mockResolvedValue(true);

    const result = await verificar({ dtUsuarioId: DT_ID, password: "correct" });
    expect(result).toEqual({ ok: true, dtUsuarioId: DT_ID });
    expect(recordCoFirmaSuccessMock).toHaveBeenCalledWith(expect.anything(), DT_ID);
  });

  it("wrong password -> generic rejection, increments intentosFallidos (shared lockout with login)", async () => {
    resolveDtCandidatoMock.mockResolvedValue({ usuarioId: DT_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null });
    verifyPasswordMock.mockResolvedValue(false);

    const result = await verificar({ dtUsuarioId: DT_ID, password: "wrong" });
    expect(result).toEqual({ ok: false, message: CO_FIRMA_LIBRO_GENERIC_ERROR });
    expect(recordCoFirmaFailureMock).toHaveBeenCalledWith(expect.anything(), DT_ID, { intentosFallidos: 1, bloqueadoHasta: null });
  });
});
