/**
 * Unit tests for FASE 12 point 12.3 (M15, user decision 5): every
 * destrucción step verifies the DT's OWN FULL PASSWORD FIRST (PIN is
 * structurally impossible -- the verify command's input schema has no
 * `pin` field), and only calls the DB write once the password check
 * succeeds. Same mocking shape as tests/unit/cierres-firmar-cierre.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, ValidationError } from "@/shared/errors";

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
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
vi.mock("@/modules/auth/domain/password", () => ({ verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args) }));

const cargarUsuarioMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null };
});
const registrarFallaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const registrarExitoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const lockLoteParaAccionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "lote-1", estado: "PLAZO_CUMPLIDO", expedienteAutorizacion: null as string | null, fechaAutorizacion: null as string | null };
});
const solicitarDestruccionDbMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const autorizarDestruccionDbMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const registrarDestruccionDbMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const jornadaActualTenantMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "2026-06-15";
});

vi.mock("@/modules/archivo/infrastructure/archivo-repository", () => ({
  cargarUsuarioParaPasswordDestruccion: (...args: unknown[]) => cargarUsuarioMock(...args),
  registrarFallaPasswordDestruccion: (...args: unknown[]) => registrarFallaMock(...args),
  registrarExitoPasswordDestruccion: (...args: unknown[]) => registrarExitoMock(...args),
  lockLoteParaAccion: (...args: unknown[]) => lockLoteParaAccionMock(...args),
  solicitarDestruccionDb: (...args: unknown[]) => solicitarDestruccionDbMock(...args),
  autorizarDestruccionDb: (...args: unknown[]) => autorizarDestruccionDbMock(...args),
  registrarDestruccionDb: (...args: unknown[]) => registrarDestruccionDbMock(...args),
  jornadaActualTenant: (...args: unknown[]) => jornadaActualTenantMock(...args),
}));

const { verificarPasswordDestruccionCommand } = await import("@/modules/archivo/application/verificar-password-destruccion");
const { solicitarDestruccion } = await import("@/modules/archivo/application/solicitar-destruccion");
const { autorizarDestruccion } = await import("@/modules/archivo/application/autorizar-destruccion");
const { registrarDestruccion } = await import("@/modules/archivo/application/registrar-destruccion");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DT_USUARIO_ID = "u-dt";
const LOTE_ID = "22222222-2222-4222-a222-222222222222";

const dtSession: AuthenticatedSession = {
  usuario: { id: DT_USUARIO_ID, email: "dt@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["archivo.destruccion.gestionar", "archivo.lotes.gestionar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  verifyPasswordMock.mockReset().mockResolvedValue(true);
  cargarUsuarioMock.mockReset().mockResolvedValue({ passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null });
  registrarFallaMock.mockClear();
  registrarExitoMock.mockClear();
  lockLoteParaAccionMock.mockReset().mockResolvedValue({ id: LOTE_ID, estado: "PLAZO_CUMPLIDO", expedienteAutorizacion: null, fechaAutorizacion: null });
  solicitarDestruccionDbMock.mockReset();
  autorizarDestruccionDbMock.mockReset();
  registrarDestruccionDbMock.mockReset();
  jornadaActualTenantMock.mockReset().mockResolvedValue("2026-06-15");
});

describe("verificarPasswordDestruccionCommand (PIN is structurally impossible)", () => {
  it("a PIN-shaped payload with no password fails validation before any credential is ever read", async () => {
    await expect(verificarPasswordDestruccionCommand.execute({ pin: "123456" }, { session: dtSession })).rejects.toBeInstanceOf(ValidationError);
    expect(cargarUsuarioMock).not.toHaveBeenCalled();
  });

  it("an empty password fails validation the same way", async () => {
    await expect(verificarPasswordDestruccionCommand.execute({ password: "" }, { session: dtSession })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("solicitarDestruccion", () => {
  it("happy path: verifies the password FIRST, then transitions PLAZO_CUMPLIDO -> DESTRUCCION_SOLICITADA", async () => {
    await solicitarDestruccion({ id: LOTE_ID, password: "correcta" }, { session: dtSession });

    expect(verifyPasswordMock).toHaveBeenCalledWith("hash", "correcta");
    expect(solicitarDestruccionDbMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, LOTE_ID);
    expect(verifyPasswordMock.mock.invocationCallOrder[0]!).toBeLessThan(solicitarDestruccionDbMock.mock.invocationCallOrder[0]!);
  });

  it("wrong password: rejects with DomainError and NEVER calls solicitarDestruccionDb", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    await expect(solicitarDestruccion({ id: LOTE_ID, password: "incorrecta" }, { session: dtSession })).rejects.toBeInstanceOf(DomainError);
    expect(solicitarDestruccionDbMock).not.toHaveBeenCalled();
    expect(registrarFallaMock).toHaveBeenCalled();
  });

  it("wrong estado: rejects with DomainError and never calls solicitarDestruccionDb", async () => {
    lockLoteParaAccionMock.mockResolvedValue({ id: LOTE_ID, estado: "EN_ARCHIVO", expedienteAutorizacion: null, fechaAutorizacion: null });

    await expect(solicitarDestruccion({ id: LOTE_ID, password: "correcta" }, { session: dtSession })).rejects.toBeInstanceOf(DomainError);
    expect(solicitarDestruccionDbMock).not.toHaveBeenCalled();
  });
});

describe("autorizarDestruccion", () => {
  beforeEach(() => {
    lockLoteParaAccionMock.mockResolvedValue({ id: LOTE_ID, estado: "DESTRUCCION_SOLICITADA", expedienteAutorizacion: null, fechaAutorizacion: null });
  });

  it("happy path: verifies password, validates expediente/fecha, then authorizes", async () => {
    await autorizarDestruccion({ id: LOTE_ID, expedienteAutorizacion: "EXP-1", fechaAutorizacion: "2026-06-15", password: "correcta" }, { session: dtSession });

    expect(autorizarDestruccionDbMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, LOTE_ID, { expedienteAutorizacion: "EXP-1", fechaAutorizacion: "2026-06-15" });
  });

  it("blank expediente: rejects with DomainError before calling autorizarDestruccionDb", async () => {
    await expect(autorizarDestruccion({ id: LOTE_ID, expedienteAutorizacion: "   ", fechaAutorizacion: "2026-06-15", password: "correcta" }, { session: dtSession })).rejects.toBeInstanceOf(Error);
    // zod strips a blank required string down to a min-length failure --
    // either way, the DB write never runs.
    expect(autorizarDestruccionDbMock).not.toHaveBeenCalled();
  });

  it("future fechaAutorizacion: rejects with DomainError before calling autorizarDestruccionDb", async () => {
    jornadaActualTenantMock.mockResolvedValue("2026-06-10");

    await expect(autorizarDestruccion({ id: LOTE_ID, expedienteAutorizacion: "EXP-1", fechaAutorizacion: "2026-06-15", password: "correcta" }, { session: dtSession })).rejects.toBeInstanceOf(DomainError);
    expect(autorizarDestruccionDbMock).not.toHaveBeenCalled();
  });

  it("wrong password: rejects with DomainError and NEVER calls autorizarDestruccionDb", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    await expect(autorizarDestruccion({ id: LOTE_ID, expedienteAutorizacion: "EXP-1", fechaAutorizacion: "2026-06-15", password: "incorrecta" }, { session: dtSession })).rejects.toBeInstanceOf(DomainError);
    expect(autorizarDestruccionDbMock).not.toHaveBeenCalled();
  });
});

describe("registrarDestruccion", () => {
  beforeEach(() => {
    lockLoteParaAccionMock.mockResolvedValue({ id: LOTE_ID, estado: "DESTRUCCION_AUTORIZADA", expedienteAutorizacion: "EXP-1", fechaAutorizacion: "2026-06-10" });
  });

  it("happy path: fechaDestruccion on/after fechaAutorizacion, not future", async () => {
    await registrarDestruccion({ id: LOTE_ID, fechaDestruccion: "2026-06-15", password: "correcta" }, { session: dtSession });

    expect(registrarDestruccionDbMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, LOTE_ID, { fechaDestruccion: "2026-06-15" });
  });

  it("fechaDestruccion before fechaAutorizacion: rejects with DomainError", async () => {
    await expect(registrarDestruccion({ id: LOTE_ID, fechaDestruccion: "2026-06-05", password: "correcta" }, { session: dtSession })).rejects.toBeInstanceOf(DomainError);
    expect(registrarDestruccionDbMock).not.toHaveBeenCalled();
  });

  it("wrong estado: rejects with DomainError", async () => {
    lockLoteParaAccionMock.mockResolvedValue({ id: LOTE_ID, estado: "DESTRUCCION_SOLICITADA", expedienteAutorizacion: null, fechaAutorizacion: null });

    await expect(registrarDestruccion({ id: LOTE_ID, fechaDestruccion: "2026-06-15", password: "correcta" }, { session: dtSession })).rejects.toBeInstanceOf(DomainError);
    expect(registrarDestruccionDbMock).not.toHaveBeenCalled();
  });
});
