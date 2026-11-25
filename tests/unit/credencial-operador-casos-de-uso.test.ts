/**
 * The generic credential use cases of the methods stored in `fsj.credencial_operador` (the huella)
 * (openspec/changes/metodos-verificacion-operador): `auth.credencialOperador.registrar` / `.eliminar` (the empleado, from
 * «Mi cuenta») and `usuarios.credencialOperador.eliminar` (the Administrador, from Usuarios › detalle). Stubbed tx and
 * repositories, same style as tests/unit/auth-configurar-pin.test.ts and tests/unit/usuarios-restablecer-pin.test.ts.
 *
 *   - registrar: current password required, code rules (min 6), uniqueness before hashing, upsert, never in the audit;
 *   - a cuenta de sector, an admin-only usuario and a disabled method are rejected on register; removal is always allowed;
 *   - the Administrador only removes (not on themselves, target locked first) and the PIN is never touched, nor does a
 *     PIN reset touch a huella.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError, DomainError, NotFoundError, ValidationError } from "@/shared/errors";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-4222-a222-222222222222";
const ADMIN_ID = "33333333-3333-4333-a333-333333333333";
const CODIGO = "H-884213-secreto";
const HASH_GUARDADO = "argon2:hash-del-codigo";
const calls: string[] = [];

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return true;
});
const hashPasswordMock = vi.fn(async (plain: string) => {
  void plain;
  return HASH_GUARDADO;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
  hashPassword: (plain: string) => hashPasswordMock(plain),
}));

const loadUsuarioParaPasswordMock = vi.fn();
const loadEsSoloAdministradorMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return false;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadUsuarioParaPassword: (...args: unknown[]) => loadUsuarioParaPasswordMock(...args),
  loadEsSoloAdministrador: (...args: unknown[]) => loadEsSoloAdministradorMock(...args),
}));

const loadMetodosHabilitadosMock = vi.fn(async (...args: unknown[]): Promise<ReadonlySet<string>> => {
  void args;
  return new Set(["PIN", "HUELLA"]);
});
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  loadMetodosHabilitados: (...args: unknown[]) => loadMetodosHabilitadosMock(...args),
}));

const hashesDeOtrosMock = vi.fn(async (...args: unknown[]): Promise<string[]> => {
  void args;
  calls.push("hashesDeOtros");
  return [];
});
const upsertMock = vi.fn(async (...args: unknown[]): Promise<{ existia: boolean }> => {
  void args;
  calls.push("upsert");
  return { existia: false };
});
const deleteMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  calls.push("delete");
  return true;
});
vi.mock("@/modules/auth/infrastructure/credencial-operador-repository", () => ({
  loadCredencialesDeOperadores: vi.fn(async () => []),
  loadCredencialHashesDeOtros: (...args: unknown[]) => hashesDeOtrosMock(...args),
  upsertCredencialOperador: (...args: unknown[]) => upsertMock(...args),
  deleteCredencialOperador: (...args: unknown[]) => deleteMock(...args),
}));

const lockMock = vi.fn(async (...args: unknown[]) => {
  void args;
  calls.push("lock");
  return { targetLocked: true, idsAdminsActivos: [] };
});
vi.mock("@/modules/usuarios/infrastructure/admin-guard", () => ({
  lockUsuarioYAdministradoresActivos: (...args: unknown[]) => lockMock(...args),
}));

let objetivo: { id: string; estado: string } | null = null;
const loadObjetivoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  calls.push("load");
  return objetivo;
});
const loadParaRestablecerPinMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: USUARIO_ID, estado: "ACTIVO", esSector: false, soloAdministrador: false, tienePin: true, pinBloqueado: false };
});
const limpiarPinMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  calls.push("limpiarPin");
  return undefined;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  loadUsuarioParaAccion: (...args: unknown[]) => loadObjetivoMock(...args),
  loadUsuarioParaRestablecerPin: (...args: unknown[]) => loadParaRestablecerPinMock(...args),
  limpiarPin: (...args: unknown[]) => limpiarPinMock(...args),
}));

const { registrarCredencialOperadorCommand } = await import("@/modules/auth/application/registrar-credencial-operador");
const { eliminarCredencialOperadorCommand } = await import("@/modules/auth/application/eliminar-credencial-operador");
const { eliminarCredencialOperadorDeUsuarioCommand } = await import("@/modules/usuarios/application/eliminar-credencial-operador");
const { restablecerPinCommand } = await import("@/modules/usuarios/application/restablecer-pin");

function sesion(permisos: string[], usuarioId = USUARIO_ID, extra: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
  return {
    usuario: { id: usuarioId, email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
    ...extra,
  };
}

const propia = () => sesion(["auth.password.cambiar"]);
const admin = () => sesion(["usuarios.credencial.restablecer"], ADMIN_ID);
const sectorSession = () => sesion(["auth.password.cambiar"], USUARIO_ID, { sector: { permisosConPin: new Set() as never } });
const INPUT = { metodo: "HUELLA" as const, passwordActual: "Contraseña-actual-1", huella: CODIGO };

function registrar(input: Record<string, unknown> = INPUT, s = propia()) {
  return registrarCredencialOperadorCommand.execute(input as never, { session: s });
}

function usuarioRow(cambios: Record<string, unknown> = {}) {
  return { id: USUARIO_ID, email: "u@example.com", passwordHash: "own-hash", pinHash: "pin-hash", debeCambiarPassword: false, esSector: false, ...cambios };
}

function auditoria(): Record<string, unknown> {
  return (auditRecordMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
}

beforeEach(() => {
  calls.length = 0;
  objetivo = { id: USUARIO_ID, estado: "ACTIVO" };
  for (const mock of [auditRecordMock, hashPasswordMock, lockMock, loadObjetivoMock, limpiarPinMock, loadParaRestablecerPinMock]) mock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(true);
  loadUsuarioParaPasswordMock.mockReset().mockResolvedValue(usuarioRow());
  loadEsSoloAdministradorMock.mockReset().mockResolvedValue(false);
  loadMetodosHabilitadosMock.mockReset().mockResolvedValue(new Set(["PIN", "HUELLA"]));
  hashesDeOtrosMock.mockReset().mockImplementation(async () => {
    calls.push("hashesDeOtros");
    return [];
  });
  upsertMock.mockReset().mockImplementation(async () => {
    calls.push("upsert");
    return { existia: false };
  });
  deleteMock.mockReset().mockImplementation(async () => {
    calls.push("delete");
    return true;
  });
});

describe("auth.credencialOperador.registrar", () => {
  it("enrols the code: uniqueness first, then hashes it and stores only the hash, audited without the code", async () => {
    await registrar();

    expect(calls).toEqual(["hashesDeOtros", "upsert"]);
    expect(hashPasswordMock).toHaveBeenCalledWith(CODIGO);
    const argumentos = upsertMock.mock.calls[0]!;
    expect(argumentos.slice(1, 5)).toEqual([TENANT_ID, USUARIO_ID, "HUELLA", HASH_GUARDADO]);
    expect(argumentos).not.toContain(CODIGO);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditoria()).toMatchObject({ entidad: "usuario", accion: "MODIFICAR", entidadId: USUARIO_ID, valorNuevo: { credencial: "HUELLA", enrolada: true } });
    expect(JSON.stringify(auditoria())).not.toContain(CODIGO);
    expect(JSON.stringify(auditoria())).not.toContain(HASH_GUARDADO);
  });

  it("replaces an enrolled code with the same write and says so in the audit", async () => {
    upsertMock.mockResolvedValue({ existia: true });
    await registrar();
    expect(auditoria()).toMatchObject({ motivo: expect.stringContaining("Reemplazo"), valorAnterior: { credencial: "HUELLA", enrolada: true } });
  });

  it("requires the current password: a wrong one rejects before the uniqueness check and writes nothing", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    await expect(registrar()).rejects.toThrow("La contraseña actual no es correcta.");
    expect(hashesDeOtrosMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("rejects a missing current password", async () => {
    await expect(registrar({ metodo: "HUELLA", huella: CODIGO })).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a code under 6 characters on the huella field and stores nothing; 6 is accepted", async () => {
    const error = await registrar({ ...INPUT, huella: "12345" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ fields: ["huella"] });
    expect((error as Error).message).toContain("6 caracteres");
    expect(upsertMock).not.toHaveBeenCalled();
    expect(loadUsuarioParaPasswordMock).not.toHaveBeenCalled();

    await registrar({ ...INPUT, huella: "123456" });
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing code", async () => {
    await expect(registrar({ metodo: "HUELLA", passwordActual: INPUT.passwordActual })).rejects.toBeInstanceOf(ValidationError);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a code another empleado holds, without saying whose, and never hashes it", async () => {
    hashesDeOtrosMock.mockResolvedValue(["otro"]);
    verifyPasswordMock.mockImplementation(async (hash: unknown) => hash === "otro" || hash === "own-hash");

    const error = await registrar().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("Ese código no se puede usar. Probá con otro.");
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a method that has no stored credential (the PIN has its own use cases)", async () => {
    await expect(registrar({ ...INPUT, metodo: "PIN" })).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a cuenta de sector, by the session and by the usuario row", async () => {
    await expect(registrar(INPUT, sectorSession())).rejects.toBeInstanceOf(DomainError);
    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow({ esSector: true }));
    await expect(registrar()).rejects.toThrow(/cuentas de sector/);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a usuario whose only role is Administrador", async () => {
    loadEsSoloAdministradorMock.mockResolvedValue(true);
    await expect(registrar()).rejects.toThrow(/Administrador/);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects while the farmacia has the method disabled", async () => {
    loadMetodosHabilitadosMock.mockResolvedValue(new Set(["PIN"]));
    await expect(registrar()).rejects.toThrow(/no está habilitado/);
    expect(hashesDeOtrosMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("is auth.password.cambiar: a session without it is rejected", async () => {
    await expect(registrar(INPUT, sesion([]))).rejects.toBeInstanceOf(AuthorizationError);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("auth.credencialOperador.eliminar (own)", () => {
  const eliminar = (s = propia()) => eliminarCredencialOperadorCommand.execute({ metodo: "HUELLA" }, { session: s });

  it("removes the own code and audits which method, never the code", async () => {
    await eliminar();
    expect(deleteMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, USUARIO_ID, "HUELLA"]);
    expect(auditoria()).toMatchObject({ entidad: "usuario", accion: "MODIFICAR", entidadId: USUARIO_ID, valorNuevo: { credencial: "HUELLA", enrolada: false } });
    expect(JSON.stringify(auditoria())).not.toMatch(/hash|argon/i);
  });

  it("is allowed while the farmacia has the method disabled (it never reads the enabled set)", async () => {
    loadMetodosHabilitadosMock.mockResolvedValue(new Set(["PIN"]));
    await expect(eliminar()).resolves.toEqual({});
    expect(loadMetodosHabilitadosMock).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to remove", async () => {
    deleteMock.mockResolvedValue(false);
    await expect(eliminar()).rejects.toThrow(/No tenés/);
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("rejects a cuenta de sector, by the session and by the usuario row", async () => {
    await expect(eliminar(sectorSession())).rejects.toThrow(/cuentas de sector/);
    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow({ esSector: true }));
    await expect(eliminar()).rejects.toThrow(/cuentas de sector/);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("usuarios.credencialOperador.eliminar (Administrador)", () => {
  const eliminar = (usuarioId = USUARIO_ID, s = admin()) => eliminarCredencialOperadorDeUsuarioCommand.execute({ usuarioId, metodo: "HUELLA" }, { session: s });

  it("locks the target, reads it, removes only that method's code and audits RESTABLECER_CREDENCIAL without the code", async () => {
    await eliminar();

    expect(calls).toEqual(["lock", "load", "delete"]);
    expect(deleteMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, USUARIO_ID, "HUELLA"]);
    expect(limpiarPinMock).not.toHaveBeenCalled(); // the PIN stays
    expect(auditoria()).toMatchObject({ entidad: "usuario", accion: "RESTABLECER_CREDENCIAL", usuarioId: ADMIN_ID, entidadId: USUARIO_ID });
    expect(JSON.stringify(auditoria())).not.toMatch(/hash|argon/i);
  });

  it("does not work on yourself: rejected before any lock or write", async () => {
    await expect(eliminar(ADMIN_ID)).rejects.toThrow(/Mi cuenta/);
    expect(lockMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("rejects a usuario that does not exist, and one without that code", async () => {
    objetivo = null;
    await expect(eliminar()).rejects.toBeInstanceOf(NotFoundError);
    objetivo = { id: USUARIO_ID, estado: "ACTIVO" };
    deleteMock.mockResolvedValue(false);
    await expect(eliminar()).rejects.toThrow(/no tiene/);
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("needs usuarios.credencial.restablecer", async () => {
    await expect(eliminar(USUARIO_ID, sesion([], ADMIN_ID))).rejects.toBeInstanceOf(AuthorizationError);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("resetting the PIN leaves the huella untouched", async () => {
    await restablecerPinCommand.execute({ usuarioId: USUARIO_ID }, { session: admin() });
    expect(limpiarPinMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
