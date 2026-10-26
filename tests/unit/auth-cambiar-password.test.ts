/**
 * Unit tests for `modules/auth/application/cambiar-password.ts` (M02, FASE 2 point 2.4,
 * openspec/specs/cuentas-de-sector/spec.md):
 * A cuenta de sector (session.sector or usuario.esSector) never changes its own password.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";

const recordMock = vi.fn(async () => undefined);
vi.mock("@/shared/audit", () => ({
  record: () => recordMock(),
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

const verifyPasswordMock = vi.fn(async () => false);
const hashPasswordMock = vi.fn(async (plain: string) => `hashed:${plain.length}`);
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: [string, string]) => verifyPasswordMock(...args),
  hashPassword: (plain: string) => hashPasswordMock(plain),
}));

const loadUsuarioParaPasswordMock = vi.fn();
const updatePasswordHashMock = vi.fn(async () => undefined);
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadUsuarioParaPassword: (...args: [unknown, string]) => loadUsuarioParaPasswordMock(...args),
  updatePasswordHash: (...args: [unknown, string, string]) => updatePasswordHashMock(...args),
}));

const revokeOtherSesionesMock = vi.fn(async () => 1);
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  revokeOtherSesionesForUsuario: (...args: [unknown, string, string, string, Date]) => revokeOtherSesionesMock(...args),
}));

const { cambiarPasswordCommand } = await import("@/modules/auth/application/cambiar-password");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-2222-2222-222222222222";

function fakeSession(overrides: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
  return {
    usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(["auth.password.cambiar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
    ...overrides,
  };
}

const VALID_INPUT = {
  actual: "ClaveActual123!",
  nueva: "NuevaClave456!",
  nuevaRepeat: "NuevaClave456!",
};

beforeEach(() => {
  recordMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(true);
  hashPasswordMock.mockClear();
  loadUsuarioParaPasswordMock.mockReset().mockResolvedValue({
    id: USUARIO_ID,
    passwordHash: "current-hash",
    esSector: false,
  });
  updatePasswordHashMock.mockClear();
  revokeOtherSesionesMock.mockClear();
});

describe("cambiarPasswordCommand", () => {
  it("rejects a cuenta de sector when session.sector is present", async () => {
    const sectorSession = fakeSession({ sector: { permisosConPin: new Set() } });

    const error = await cambiarPasswordCommand
      .execute(VALID_INPUT, { session: sectorSession })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe(
      "Una cuenta de sector no cambia su contraseña: la define el Administrador desde Usuarios.",
    );
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(updatePasswordHashMock).not.toHaveBeenCalled();
  });

  it("rejects a cuenta de sector when usuario.esSector is true in database", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue({
      id: USUARIO_ID,
      passwordHash: "current-hash",
      esSector: true,
    });

    const error = await cambiarPasswordCommand
      .execute(VALID_INPUT, { session: fakeSession() })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe(
      "Una cuenta de sector no cambia su contraseña: la define el Administrador desde Usuarios.",
    );
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(updatePasswordHashMock).not.toHaveBeenCalled();
  });

  it("rejects when the actual password does not match", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    const error = await cambiarPasswordCommand
      .execute(VALID_INPUT, { session: fakeSession() })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("La contraseña actual no es correcta.");
    expect(updatePasswordHashMock).not.toHaveBeenCalled();
  });

  it("updates password hash and revokes other sessions on valid input", async () => {
    const result = await cambiarPasswordCommand.execute(VALID_INPUT, { session: fakeSession() });

    expect(result).toEqual({ sesionesRevocadas: 1 });
    expect(updatePasswordHashMock).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTx: true }),
      USUARIO_ID,
      "hashed:14",
    );
    expect(revokeOtherSesionesMock).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTx: true }),
      TENANT_ID,
      USUARIO_ID,
      "s1",
      expect.any(Date),
    );
  });
});
