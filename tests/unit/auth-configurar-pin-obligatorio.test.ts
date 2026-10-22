/**
 * Unit tests for `modules/auth/application/configurar-pin-obligatorio.ts`
 * (docs/specs/contrasena-temporal.md, step 2): everything I/O is mocked,
 * same style as tests/unit/auth-cambiar-password-temporal.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";

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

const hashPasswordMock = vi.fn(async (plain: string) => `hashed:${plain.length}`);
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: vi.fn(async () => false),
  hashPassword: (plain: string) => hashPasswordMock(plain),
}));

const loadUsuarioParaPasswordMock = vi.fn();
const setPinHashMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadUsuarioParaPassword: (...args: unknown[]) => loadUsuarioParaPasswordMock(...args),
  setPinHash: (...args: unknown[]) => setPinHashMock(...args),
}));

const { configurarPinObligatorioCommand } = await import("@/modules/auth/application/configurar-pin-obligatorio");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-2222-2222-222222222222";
const PIN = "4821";

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["auth.password.cambiar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: null,
};

function execute(input: { pin: string; pinRepeat: string }, sessionOverride: AuthenticatedSession = session) {
  return configurarPinObligatorioCommand.execute(input, { session: sessionOverride });
}

function usuarioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USUARIO_ID,
    email: "u@example.com",
    passwordHash: "own-hash",
    pinHash: null,
    debeCambiarPassword: false,
    esSector: false,
    ...overrides,
  };
}

beforeEach(() => {
  recordMock.mockClear();
  hashPasswordMock.mockClear();
  loadUsuarioParaPasswordMock.mockReset().mockResolvedValue(usuarioRow());
  setPinHashMock.mockClear();
});

describe("configurarPinObligatorio", () => {
  it("stores a hashed PIN and audits MODIFICAR with the exact motivo, never the PIN or hash", async () => {
    await execute({ pin: PIN, pinRepeat: PIN });

    expect(setPinHashMock).toHaveBeenCalledTimes(1);
    const [, usuarioId, hash] = setPinHashMock.mock.calls[0]!;
    expect(usuarioId).toBe(USUARIO_ID);
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe(PIN);

    expect(recordMock).toHaveBeenCalledTimes(1);
    const auditJson = JSON.stringify(recordMock.mock.calls[0]!);
    expect(auditJson).toContain("Configuración de PIN de reautenticación rápida por el propio usuario.");
    expect(auditJson).toContain("MODIFICAR");
    expect(auditJson).toContain(USUARIO_ID);
    expect(auditJson).not.toContain(PIN);
    expect(auditJson).not.toContain(String(hash));
  });

  it("rejects when the PIN already exists", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow({ pinHash: "existing-pin-hash" }));

    const error = await execute({ pin: PIN, pinRepeat: PIN }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("Ya tenés un PIN configurado. Podés cambiarlo desde «Mi cuenta».");
    expect(setPinHashMock).not.toHaveBeenCalled();
  });

  it("rejects while the password change is pending", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow({ debeCambiarPassword: true }));

    const error = await execute({ pin: PIN, pinRepeat: PIN }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("Primero tenés que cambiar tu contraseña temporal.");
    expect(setPinHashMock).not.toHaveBeenCalled();
  });

  it("rejects a cuenta de sector (CT6), by DB row and by session", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow({ esSector: true }));
    const byRow = await execute({ pin: PIN, pinRepeat: PIN }).catch((e: unknown) => e);
    expect(byRow).toBeInstanceOf(DomainError);
    expect((byRow as DomainError).message).toBe("Las cuentas de sector no usan PIN.");

    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow());
    const sectorSession: AuthenticatedSession = { ...session, sector: { permisosConPin: new Set() } };
    const bySession = await execute({ pin: PIN, pinRepeat: PIN }, sectorSession).catch((e: unknown) => e);
    expect(bySession).toBeInstanceOf(DomainError);
    expect((bySession as DomainError).message).toBe("Las cuentas de sector no usan PIN.");

    expect(setPinHashMock).not.toHaveBeenCalled();
  });

  it("rejects when the usuario row is missing", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue(null);

    await expect(execute({ pin: PIN, pinRepeat: PIN })).rejects.toThrow("No se pudo configurar el PIN.");
    expect(setPinHashMock).not.toHaveBeenCalled();
  });

  it("rejects trivial or mismatched PINs (fields pin / pinRepeat)", async () => {
    const mismatch = await execute({ pin: PIN, pinRepeat: "4822" }).catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(Error);
    expect((mismatch as { fields?: string[] }).fields).toContain("pinRepeat");

    const trivial = await execute({ pin: "1111", pinRepeat: "1111" }).catch((e: unknown) => e);
    expect(trivial).toBeInstanceOf(Error);
    expect((trivial as { fields?: string[] }).fields).toContain("pin");

    expect(setPinHashMock).not.toHaveBeenCalled();
  });
});
