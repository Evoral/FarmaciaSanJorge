/**
 * Contraseña temporal (docs/specs/contrasena-temporal.md) x cuentas de sector:
 * a usuario with a pending password change cannot identify as operador, even
 * with the correct PIN, and that must not count a failed PIN attempt.
 * Mocks mirror tests/unit/cuentas-de-sector-verificar-operador.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { decideCandidatoOperador } from "@/modules/auth/domain/operador-policy";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return false;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

const loadUsuarioConPermisosMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  loadUsuarioConPermisos: (...args: unknown[]) => loadUsuarioConPermisosMock(...args),
}));

const loadPinEstadoMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
const recordPinFailureMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
const resetPinLockoutMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadPinEstado: (...args: unknown[]) => loadPinEstadoMock(...args),
  recordPinFailure: (...args: unknown[]) => recordPinFailureMock(...args),
  resetPinLockout: (...args: unknown[]) => resetPinLockoutMock(...args),
}));

const { verificarOperadorEnTx, MENSAJE_OPERADOR_RECHAZADO } = await import("@/modules/auth/application/verificar-operador");
const { listOperadores } = await import("@/modules/operadores/infrastructure/operadores-repository");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SECTOR_ID = "22222222-2222-4222-a222-222222222222";
const EMPLEADO_ID = "33333333-3333-4333-a333-333333333333";
const TX = { __fakeTx: true } as never;

const sector: AuthenticatedSession = {
  usuario: { id: SECTOR_ID, email: "laboratorio@example.com", nombre: "Laboratorio", apellido: "Fondo" },
  tenantId: TENANT_ID,
  sesionId: "sesion-sector",
  permisos: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: null,
  sector: { permisosConPin: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"] },
};

function empleado(extra: Record<string, unknown> = {}) {
  return {
    id: EMPLEADO_ID,
    tenantId: TENANT_ID,
    email: "ana@example.com",
    nombre: "Ana",
    apellido: "Gómez",
    estado: "ACTIVO",
    esSector: false,
    esTecnico: false,
    debeCambiarPassword: false,
    permisos: new Set(["preparaciones.confirmar"]),
    ...extra,
  };
}

const credencial = (pin = "4829") => ({ usuarioId: EMPLEADO_ID, prueba: { metodo: "PIN", pin } });

beforeEach(() => {
  auditRecordMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  loadUsuarioConPermisosMock.mockReset().mockResolvedValue(empleado());
  loadPinEstadoMock.mockReset().mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 0 });
  recordPinFailureMock.mockClear();
  resetPinLockoutMock.mockClear();
});

describe("decideCandidatoOperador with a pending password change", () => {
  const ok = { encontrado: true, estado: "ACTIVO", esSector: false, esTecnico: false, debeCambiarPassword: false };

  it("returns DEBE_CAMBIAR_PASSWORD for an otherwise eligible usuario", () => {
    expect(decideCandidatoOperador(ok)).toBe("OK");
    expect(decideCandidatoOperador({ ...ok, debeCambiarPassword: true })).toBe("DEBE_CAMBIAR_PASSWORD");
  });

  it("not found, sector, technical and inactive still win over the pending change", () => {
    const pendiente = { ...ok, debeCambiarPassword: true };
    expect(decideCandidatoOperador({ ...pendiente, encontrado: false, estado: null })).toBe("NO_ENCONTRADO");
    expect(decideCandidatoOperador({ ...pendiente, esSector: true })).toBe("NO_ES_EMPLEADO");
    expect(decideCandidatoOperador({ ...pendiente, esTecnico: true })).toBe("NO_ES_EMPLEADO");
    expect(decideCandidatoOperador({ ...pendiente, estado: "SUSPENDIDO" })).toBe("INACTIVO");
  });
});

describe("verificarOperadorEnTx with a pending password change", () => {
  it("CT7 verificarOperadorEnTx rejects a usuario with debeCambiarPassword even with the correct PIN", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    loadUsuarioConPermisosMock.mockResolvedValue(empleado({ debeCambiarPassword: true }));

    const resultado = await verificarOperadorEnTx(TX, sector, credencial());

    expect(resultado).toEqual({ ok: false, message: MENSAJE_OPERADOR_RECHAZADO });
    // No failed attempt is counted, and the PIN lockout is untouched.
    expect(recordPinFailureMock).not.toHaveBeenCalled();
    expect(resetPinLockoutMock).not.toHaveBeenCalled();
    // Constant work: argon2 still runs once (against the dummy hash).
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
    expect(verifyPasswordMock).toHaveBeenCalledWith(null, "4829");
    expect(loadPinEstadoMock).not.toHaveBeenCalled();
    // One rejected-attempt audit naming the internal reason.
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ entidad: "operador", entidadId: EMPLEADO_ID, accion: "AUTORIZAR", usuarioId: SECTOR_ID });
    expect((auditRecordMock.mock.calls[0]![1] as { motivo: string }).motivo).toContain("DEBE_CAMBIAR_PASSWORD");
  });
});

describe("listOperadores", () => {
  it("excludes usuarios with a pending password change", async () => {
    const findMany = vi.fn(async (args: { where: unknown }) => (void args, []));
    const tx = { usuario: { findMany } } as never;

    await listOperadores(tx, TENANT_ID);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].where).toEqual({
      tenantId: TENANT_ID,
      estado: "ACTIVO",
      esSector: false,
      esTecnico: false,
      pinHash: { not: null },
      debeCambiarPassword: false,
    });
  });
});
