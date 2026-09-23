/**
 * Unit tests for `modules/stock/domain/co-firma.ts` (FASE 5 point 5.3,
 * DP-08b RESUELTA) and `modules/stock/application/verificar-co-firma-dt.ts`.
 * The domain half is pure (no mocks); the application half mocks its
 * infrastructure + session/transaction, same pattern as
 * tests/unit/catalogos-fase4-m3-concurrencia.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { decideCoFirma, estaBloqueado } from "@/modules/stock/domain/co-firma";

const NOW = new Date("2026-06-15T12:00:00Z");

describe("decideCoFirma (pure decision table)", () => {
  it("unknown DT: found=false -> DESCONOCIDO, regardless of every other input", () => {
    expect(
      decideCoFirma({ found: false, estado: null, bloqueadoHasta: null, passwordMatches: true, esDtVigente: true, now: NOW }),
    ).toBe("DESCONOCIDO");
  });

  it("locked out: bloqueadoHasta in the future -> BLOQUEADO, even with the right password", () => {
    expect(
      decideCoFirma({
        found: true,
        estado: "ACTIVO",
        bloqueadoHasta: new Date(NOW.getTime() + 60_000),
        passwordMatches: true,
        esDtVigente: true,
        now: NOW,
      }),
    ).toBe("BLOQUEADO");
  });

  it("a PAST bloqueadoHasta does not lock -- falls through to the next check", () => {
    expect(
      decideCoFirma({
        found: true,
        estado: "ACTIVO",
        bloqueadoHasta: new Date(NOW.getTime() - 60_000),
        passwordMatches: true,
        esDtVigente: true,
        now: NOW,
      }),
    ).toBe("OK");
  });

  it("inactive: estado !== ACTIVO -> INACTIVO", () => {
    expect(
      decideCoFirma({ found: true, estado: "SUSPENDIDO", bloqueadoHasta: null, passwordMatches: true, esDtVigente: true, now: NOW }),
    ).toBe("INACTIVO");
  });

  it("wrong password: ACTIVO, not locked, but passwordMatches=false -> PASSWORD_INCORRECTA", () => {
    expect(
      decideCoFirma({ found: true, estado: "ACTIVO", bloqueadoHasta: null, passwordMatches: false, esDtVigente: true, now: NOW }),
    ).toBe("PASSWORD_INCORRECTA");
  });

  it("no current designation: correct password but esDtVigente=false -> NO_VIGENTE_DT", () => {
    expect(
      decideCoFirma({ found: true, estado: "ACTIVO", bloqueadoHasta: null, passwordMatches: true, esDtVigente: false, now: NOW }),
    ).toBe("NO_VIGENTE_DT");
  });

  it("valid: found, ACTIVO, not locked, correct password, DT vigente -> OK", () => {
    expect(
      decideCoFirma({ found: true, estado: "ACTIVO", bloqueadoHasta: null, passwordMatches: true, esDtVigente: true, now: NOW }),
    ).toBe("OK");
  });
});

describe("estaBloqueado", () => {
  it("null bloqueadoHasta is never locked", () => {
    expect(estaBloqueado(null, NOW)).toBe(false);
  });
  it("a bloqueadoHasta exactly equal to now is NOT locked (strictly greater is required)", () => {
    expect(estaBloqueado(NOW, NOW)).toBe(false);
  });
});

// ============================================================================
// verificarCoFirmaDt -- mocked infra/session, mirrors login()'s own shape.
// ============================================================================
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
  permisos: new Set(["stock.ajuste.registrar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
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
vi.mock("@/modules/stock/infrastructure/co-firma-repository", () => ({
  resolveDtCandidato: (...args: unknown[]) => resolveDtCandidatoMock(...args),
  esDtVigenteHoy: (...args: unknown[]) => esDtVigenteHoyMock(...args),
  recordCoFirmaFailure: (...args: unknown[]) => recordCoFirmaFailureMock(...args),
  recordCoFirmaSuccess: (...args: unknown[]) => recordCoFirmaSuccessMock(...args),
}));

const { verificarCoFirmaDtCommand, CO_FIRMA_GENERIC_ERROR } = await import("@/modules/stock/application/verificar-co-firma-dt");

function verificarCoFirmaDt(input: { dtUsuarioId: string; password: string }) {
  return verificarCoFirmaDtCommand.execute(input, { session: operadorSession });
}

const DT_ID = "22222222-2222-4222-a222-222222222222";

describe("verificarCoFirmaDt", () => {
  beforeEach(() => {
    resolveDtCandidatoMock.mockReset();
    esDtVigenteHoyMock.mockReset().mockResolvedValue(false);
    verifyPasswordMock.mockReset().mockResolvedValue(false);
    recordCoFirmaFailureMock.mockClear();
    recordCoFirmaSuccessMock.mockClear();
  });

  it("unknown DT: resolveDtCandidato returns null -> generic rejection, no lockout write (nothing to lock)", async () => {
    resolveDtCandidatoMock.mockResolvedValue(null);
    const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "whatever" });
    expect(result).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });
    expect(recordCoFirmaFailureMock).not.toHaveBeenCalled();
  });

  it("wrong password: found + ACTIVO, but password does not match -> generic rejection, increments intentosFallidos", async () => {
    resolveDtCandidatoMock.mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(false);

    const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "wrong" });
    expect(result).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });
    expect(recordCoFirmaFailureMock).toHaveBeenCalledWith(expect.anything(), DT_ID, { intentosFallidos: 1, bloqueadoHasta: null });
  });

  it("inactive: found, correct password, but estado !== ACTIVO -> generic rejection", async () => {
    resolveDtCandidatoMock.mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash",
      estado: "SUSPENDIDO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(true);

    const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "correct" });
    expect(result).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });
    // INACTIVO is not a wrong-password outcome -- no lockout bookkeeping.
    expect(recordCoFirmaFailureMock).not.toHaveBeenCalled();
  });

  it("no current designation: found, ACTIVO, correct password, but not DT vigente -> generic rejection", async () => {
    resolveDtCandidatoMock.mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(true);
    esDtVigenteHoyMock.mockResolvedValue(false);

    const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "correct" });
    expect(result).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });
  });

  it("valid: found, ACTIVO, correct password, DT vigente -> ok, resets lockout, returns the DT id", async () => {
    resolveDtCandidatoMock.mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash",
      estado: "ACTIVO",
      intentosFallidos: 2,
      bloqueadoHasta: null,
    });
    verifyPasswordMock.mockResolvedValue(true);
    esDtVigenteHoyMock.mockResolvedValue(true);

    const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "correct" });
    expect(result).toEqual({ ok: true, dtUsuarioId: DT_ID });
    expect(recordCoFirmaSuccessMock).toHaveBeenCalledWith(expect.anything(), DT_ID);
  });

  it("every rejection reason produces the EXACT SAME generic message (never leaks which check failed)", async () => {
    const scenarios: Array<() => void> = [
      () => resolveDtCandidatoMock.mockResolvedValue(null),
      () =>
        resolveDtCandidatoMock.mockResolvedValue({ usuarioId: DT_ID, passwordHash: "h", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null }),
      () =>
        resolveDtCandidatoMock.mockResolvedValue({ usuarioId: DT_ID, passwordHash: "h", estado: "BAJA", intentosFallidos: 0, bloqueadoHasta: null }),
    ];

    const messages = new Set<string>();
    for (const setup of scenarios) {
      resolveDtCandidatoMock.mockReset();
      verifyPasswordMock.mockReset().mockResolvedValue(false);
      setup();
      const result = await verificarCoFirmaDt({ dtUsuarioId: DT_ID, password: "x" });
      if (!result.ok) messages.add(result.message);
    }
    expect(messages.size).toBe(1);
  });
});
