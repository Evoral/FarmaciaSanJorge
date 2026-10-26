/**
 * Unit tests for `modules/auth/application/configurar-pin.ts` («Mi cuenta»):
 * cuentas de sector and usuarios whose only role is Administrador have no PIN
 * (openspec/specs/contrasena-temporal/spec.md, CT6/CT9), so the command rejects them
 * server-side even though the panel is hidden. Same mocking style as
 * tests/unit/auth-configurar-pin-obligatorio.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, ValidationError } from "@/shared/errors";

const recordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => recordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => session),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return true;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain.length}`),
}));

const loadUsuarioParaPasswordMock = vi.fn();
const loadEsSoloAdministradorMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return false;
});
const setPinHashMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
// Other usuarios' PIN hashes (uniqueness check, pin-disponible.ts): none by default.
const loadPinHashesDeOtrosMock = vi.fn(async (...args: unknown[]): Promise<string[]> => {
  void args;
  return [];
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadUsuarioParaPassword: (...args: unknown[]) => loadUsuarioParaPasswordMock(...args),
  loadEsSoloAdministrador: (...args: unknown[]) => loadEsSoloAdministradorMock(...args),
  setPinHash: (...args: unknown[]) => setPinHashMock(...args),
  loadPinHashesDeOtros: (...args: unknown[]) => loadPinHashesDeOtrosMock(...args),
}));

const { configurarPinCommand } = await import("@/modules/auth/application/configurar-pin");
const { MENSAJE_PIN_NO_DISPONIBLE } = await import("@/modules/auth/application/pin-disponible");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-2222-2222-222222222222";
const PIN = "4821";
const INPUT = { passwordActual: "Contraseña-actual-1", pin: PIN, pinRepeat: PIN };

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["auth.password.cambiar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: null,
};

function execute(sessionOverride: AuthenticatedSession = session) {
  return configurarPinCommand.execute(INPUT, { session: sessionOverride });
}

function usuarioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USUARIO_ID,
    email: "u@example.com",
    passwordHash: "own-hash",
    pinHash: "old-pin-hash",
    debeCambiarPassword: false,
    esSector: false,
    ...overrides,
  };
}

beforeEach(() => {
  recordMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(true);
  loadUsuarioParaPasswordMock.mockReset().mockResolvedValue(usuarioRow());
  loadEsSoloAdministradorMock.mockReset().mockResolvedValue(false);
  setPinHashMock.mockClear();
  loadPinHashesDeOtrosMock.mockReset().mockResolvedValue([]);
});

describe("configurarPin («Mi cuenta»)", () => {
  it("rejects a PIN another usuario of the farmacia already uses, without saying it is taken", async () => {
    loadPinHashesDeOtrosMock.mockResolvedValue(["otro-pin-hash"]);

    const error = await execute().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(MENSAJE_PIN_NO_DISPONIBLE);
    expect(loadPinHashesDeOtrosMock).toHaveBeenCalledWith(expect.objectContaining({ __fakeTx: true }), TENANT_ID, USUARIO_ID);
    expect(verifyPasswordMock).toHaveBeenCalledWith("otro-pin-hash", PIN);
    expect(setPinHashMock).not.toHaveBeenCalled();
  });

  it("changes the PIN of a usuario who uses one", async () => {
    await execute();

    expect(setPinHashMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it("CT6: rejects a cuenta de sector, by DB row and by session, before checking the password", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow({ esSector: true }));
    const byRow = await execute().catch((e: unknown) => e);
    expect(byRow).toBeInstanceOf(DomainError);
    expect((byRow as DomainError).message).toBe("Las cuentas de sector no usan PIN.");

    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow());
    const sectorSession: AuthenticatedSession = { ...session, sector: { permisosConPin: new Set() } };
    const bySession = await execute(sectorSession).catch((e: unknown) => e);
    expect(bySession).toBeInstanceOf(DomainError);
    expect((bySession as DomainError).message).toBe("Las cuentas de sector no usan PIN.");

    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(setPinHashMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("CT9: rejects a usuario whose only role is Administrador, read inside the transaction", async () => {
    loadEsSoloAdministradorMock.mockResolvedValue(true);

    const error = await execute().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("El Administrador no usa PIN.");
    expect(loadEsSoloAdministradorMock).toHaveBeenCalledWith(expect.objectContaining({ __fakeTx: true }), USUARIO_ID);
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(setPinHashMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });
});
