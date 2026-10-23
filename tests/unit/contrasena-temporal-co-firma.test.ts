/**
 * CT8 (docs/specs/contrasena-temporal.md): a DT with `debe_cambiar_password`
 * cannot co-sign (stock, libro, pesada real), even with the right password,
 * and the attempt never counts toward the lockout. Same style as
 * tests/unit/stock-co-firma.test.ts and contrasena-temporal-operadores.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { decideCoFirma } from "@/modules/stock/domain/co-firma";

const NOW = new Date("2026-10-23T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 60_000);

function input(overrides: Partial<Parameters<typeof decideCoFirma>[0]> = {}) {
  return {
    found: true,
    estado: "ACTIVO" as string | null,
    bloqueadoHasta: null as Date | null,
    debeCambiarPassword: false,
    passwordMatches: true,
    esDtVigente: true,
    now: NOW,
    ...overrides,
  };
}

describe("decideCoFirma: DEBE_CAMBIAR_PASSWORD", () => {
  it("rejects an otherwise valid DT with a pending password change, even with the right password", () => {
    expect(decideCoFirma(input({ debeCambiarPassword: true }))).toBe("DEBE_CAMBIAR_PASSWORD");
  });

  it("is decided before the password check: a wrong password does not become PASSWORD_INCORRECTA (no failed attempt)", () => {
    expect(decideCoFirma(input({ debeCambiarPassword: true, passwordMatches: false }))).toBe("DEBE_CAMBIAR_PASSWORD");
  });

  it("is decided before the vigencia check", () => {
    expect(decideCoFirma(input({ debeCambiarPassword: true, esDtVigente: false }))).toBe("DEBE_CAMBIAR_PASSWORD");
  });

  it("not-found, locked and inactive still win over it", () => {
    expect(decideCoFirma(input({ debeCambiarPassword: true, found: false, estado: null }))).toBe("DESCONOCIDO");
    expect(decideCoFirma(input({ debeCambiarPassword: true, bloqueadoHasta: FUTURE }))).toBe("BLOQUEADO");
    expect(decideCoFirma(input({ debeCambiarPassword: true, estado: "SUSPENDIDO" }))).toBe("INACTIVO");
  });

  it("flag false and everything valid keeps returning OK", () => {
    expect(decideCoFirma(input())).toBe("OK");
  });
});

// ============================================================================
// Verification paths (stock + libro) -- mocked infra/session.
// ============================================================================
const recordAuditMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => recordAuditMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId })),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

// The `list*` and `resolveDtCandidato` real implementations stay reachable
// through `importActual`; only the verification path's collaborators are faked.
const resolveDtCandidatoMock = vi.fn();
const esDtVigenteHoyMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
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
vi.mock("@/modules/libro/infrastructure/co-firma-repository", () => ({
  resolveDtCandidato: (...args: unknown[]) => resolveDtCandidatoMock(...args),
  esDtVigenteHoy: (...args: unknown[]) => esDtVigenteHoyMock(...args),
  recordCoFirmaFailure: (...args: unknown[]) => recordCoFirmaFailureMock(...args),
  recordCoFirmaSuccess: (...args: unknown[]) => recordCoFirmaSuccessMock(...args),
}));

const { verificarCoFirmaDtCommand, CO_FIRMA_GENERIC_ERROR } = await import("@/modules/stock/application/verificar-co-firma-dt");
const { verificarCoFirmaDtLibroCommand, CO_FIRMA_LIBRO_GENERIC_ERROR } = await import("@/modules/libro/application/verificar-co-firma-dt");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DT_ID = "22222222-2222-4222-a222-222222222222";

function sessionWith(permiso: string): AuthenticatedSession {
  return {
    usuario: { id: "u-operador", email: "op@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set([permiso]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

function candidato(overrides: Record<string, unknown> = {}) {
  return {
    usuarioId: DT_ID,
    passwordHash: "hash",
    estado: "ACTIVO",
    intentosFallidos: 0,
    bloqueadoHasta: null,
    debeCambiarPassword: false,
    ...overrides,
  };
}

beforeEach(() => {
  recordAuditMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(true);
  resolveDtCandidatoMock.mockReset();
  esDtVigenteHoyMock.mockReset().mockResolvedValue(true);
  recordCoFirmaFailureMock.mockClear();
  recordCoFirmaSuccessMock.mockClear();
});

describe("stock co-firma with a pending password change", () => {
  const execute = () => verificarCoFirmaDtCommand.execute({ dtUsuarioId: DT_ID, password: "temporal" }, { session: sessionWith("stock.ajuste.registrar") });

  it("rejects with the generic message, records no failed attempt and audits DEBE_CAMBIAR_PASSWORD", async () => {
    resolveDtCandidatoMock.mockResolvedValue(candidato({ debeCambiarPassword: true, intentosFallidos: 4 }));

    const result = await execute();

    expect(result).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });
    expect(recordCoFirmaFailureMock).not.toHaveBeenCalled();
    expect(recordCoFirmaSuccessMock).not.toHaveBeenCalled();
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(recordAuditMock.mock.calls[0])).toContain("DEBE_CAMBIAR_PASSWORD");
    // Constant work: the password is still verified, same as the other non-OK paths.
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
  });

  it("the same DT without the flag co-signs normally", async () => {
    resolveDtCandidatoMock.mockResolvedValue(candidato());

    await expect(execute()).resolves.toEqual({ ok: true, dtUsuarioId: DT_ID });
    expect(recordCoFirmaSuccessMock).toHaveBeenCalledWith(expect.anything(), DT_ID);
  });
});

describe("libro co-firma with a pending password change", () => {
  const execute = () =>
    verificarCoFirmaDtLibroCommand.execute({ dtUsuarioId: DT_ID, password: "temporal" }, { session: sessionWith("libro.anulacion.solicitar") });

  it("rejects with the generic message, records no failed attempt and audits DEBE_CAMBIAR_PASSWORD", async () => {
    resolveDtCandidatoMock.mockResolvedValue(candidato({ debeCambiarPassword: true }));

    const result = await execute();

    expect(result).toEqual({ ok: false, message: CO_FIRMA_LIBRO_GENERIC_ERROR });
    expect(recordCoFirmaFailureMock).not.toHaveBeenCalled();
    expect(recordCoFirmaSuccessMock).not.toHaveBeenCalled();
    expect(JSON.stringify(recordAuditMock.mock.calls[0])).toContain("DEBE_CAMBIAR_PASSWORD");
  });
});

// ============================================================================
// Repositories (real implementations against a fake transaction).
// ============================================================================
describe.each([
  ["stock", "@/modules/stock/infrastructure/co-firma-repository"],
  ["libro", "@/modules/libro/infrastructure/co-firma-repository"],
])("%s co-firma repository", (_name, path) => {
  it("resolveDtCandidato selects debeCambiarPassword and returns it", async () => {
    const actual = await vi.importActual<typeof import("@/modules/stock/infrastructure/co-firma-repository")>(path);
    const findUnique = vi.fn(async (args: unknown) => {
      void args;
      return { id: DT_ID, passwordHash: "h", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null, debeCambiarPassword: true };
    });
    const tx = { usuario: { findUnique } } as never;

    const row = await actual.resolveDtCandidato(tx, TENANT_ID, DT_ID);

    expect((findUnique.mock.calls[0]![0] as { select: Record<string, boolean> }).select.debeCambiarPassword).toBe(true);
    expect(row?.debeCambiarPassword).toBe(true);
  });

  it("listDtVigentesParaCoFirma filters out DTs with a pending password change", async () => {
    const actual = await vi.importActual<typeof import("@/modules/stock/infrastructure/co-firma-repository")>(path);
    const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      void strings;
      void values;
      return [];
    });
    const tx = { $queryRaw: queryRaw } as never;

    await actual.listDtVigentesParaCoFirma(tx, TENANT_ID);

    const sql = (queryRaw.mock.calls[0]![0] as unknown as string[]).join("?");
    expect(sql).toMatch(/u\.debe_cambiar_password\s*=\s*false/);
  });
});
