/**
 * Unit tests for `restablecerCredencial` as "assign a temporary password"
 * (openspec/specs/contrasena-temporal/spec.md): stubbed tx, mocked repository, same
 * style as tests/unit/usuarios-m3-lock-order.test.ts.
 *
 *   CT1: neither the plaintext nor the hash reaches the audit row or the output.
 *   CT5: the reset never touches the PIN (no pin fields, no cambiarEstadoUsuario for ACTIVO).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DomainError, ValidationError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";

const TARGET_ID = "22222222-2222-4222-a222-222222222222";
const ADMIN_ID = "33333333-3333-4333-a333-333333333333";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const PASSWORD_TEMPORAL = "Temporal-Segura-2026";
const passwordFields = { passwordTemporal: PASSWORD_TEMPORAL, passwordTemporalRepeat: PASSWORD_TEMPORAL };

let estadoActual = "ACTIVO";

const lockMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { targetLocked: true, idsAdminsActivos: [] };
});
vi.mock("@/modules/usuarios/infrastructure/admin-guard", () => ({
  lockUsuarioYAdministradoresActivos: (...args: unknown[]) => lockMock(...args),
}));

const loadUsuarioParaAccionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: TARGET_ID, estado: estadoActual, esTecnico: false, esSector: false, roles: ["FARMACEUTICO"], nombre: "N", apellido: "A", email: "n@example.com", dni: "1", numeroMatricula: null };
});
const cambiarEstadoUsuarioMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
const restablecerPasswordTemporalMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  loadUsuarioParaAccion: (...args: unknown[]) => loadUsuarioParaAccionMock(...args),
  cambiarEstadoUsuario: (...args: unknown[]) => cambiarEstadoUsuarioMock(...args),
  restablecerPasswordTemporal: (...args: unknown[]) => restablecerPasswordTemporalMock(...args),
}));

const revokeAllSesionesMock = vi.fn(async (...args: unknown[]): Promise<number> => {
  void args;
  return 2;
});
vi.mock("@/modules/auth/application/revoke-session", () => ({
  revokeAllSesionesForUsuarioInTx: (...args: unknown[]) => revokeAllSesionesMock(...args),
}));

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
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

const { restablecerCredencialCommand } = await import("@/modules/usuarios/application/restablecer-credencial");

function fakeSession(usuarioId = ADMIN_ID): AuthenticatedSession {
  return {
    usuario: { id: usuarioId, email: "admin@example.com", nombre: "A", apellido: "D" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(["usuarios.credencial.restablecer"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

function run(input: Record<string, unknown> = {}, session = fakeSession()) {
  return restablecerCredencialCommand.execute({ usuarioId: TARGET_ID, ...passwordFields, ...input }, { session });
}

function auditInput(): Record<string, unknown> {
  return (auditRecordMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
}

beforeEach(() => {
  estadoActual = "ACTIVO";
  for (const mock of [lockMock, loadUsuarioParaAccionMock, cambiarEstadoUsuarioMock, restablecerPasswordTemporalMock, revokeAllSesionesMock, auditRecordMock]) mock.mockClear();
});

describe("restablecerCredencial: assigns a temporary password", () => {
  it("ACTIVO: sets hash + flag, resets lock counters, revokes all sessions, never calls cambiarEstadoUsuario, and passes no pin fields", async () => {
    const output = await run();

    expect(output).toEqual({ estado: "ACTIVO", esSector: false });
    expect(restablecerPasswordTemporalMock).toHaveBeenCalledTimes(1);
    const args = restablecerPasswordTemporalMock.mock.calls[0]!;
    expect(args).toHaveLength(4); // (tx, usuarioId, passwordHash, debeCambiarPassword): nothing else can carry a PIN change
    expect(args[3]).toBe(true);
    expect(args[1]).toBe(TARGET_ID);
    expect(args[2]).toMatch(/^\$argon2id\$/);

    expect(cambiarEstadoUsuarioMock).not.toHaveBeenCalled();
    expect(revokeAllSesionesMock).toHaveBeenCalledTimes(1);
    expect(revokeAllSesionesMock.mock.calls[0]!.slice(1, 3)).toEqual([TENANT_ID, TARGET_ID]);

    const everything = JSON.stringify([...restablecerPasswordTemporalMock.mock.calls.map((c) => c.slice(1)), cambiarEstadoUsuarioMock.mock.calls]);
    expect(everything).not.toMatch(/pinHash|clearPin/);
  });

  it("PENDIENTE_ACTIVACION becomes ACTIVO", async () => {
    estadoActual = "PENDIENTE_ACTIVACION";
    const output = await run();

    expect(output).toEqual({ estado: "ACTIVO", esSector: false });
    expect(cambiarEstadoUsuarioMock).toHaveBeenCalledTimes(1);
    expect(cambiarEstadoUsuarioMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estadoAnterior: "PENDIENTE_ACTIVACION", estadoNuevo: "ACTIVO", usuarioId: TARGET_ID, cambiadoPorId: ADMIN_ID }),
    );
    expect(auditInput()).toMatchObject({ valorAnterior: { estado: "PENDIENTE_ACTIVACION" }, valorNuevo: { estado: "ACTIVO" } });
  });

  it("SUSPENDIDO stays SUSPENDIDO", async () => {
    estadoActual = "SUSPENDIDO";
    const output = await run();

    expect(output).toEqual({ estado: "SUSPENDIDO", esSector: false });
    expect(cambiarEstadoUsuarioMock).not.toHaveBeenCalled();
    expect(restablecerPasswordTemporalMock).toHaveBeenCalledTimes(1);
    expect(auditInput()).toMatchObject({ valorAnterior: { estado: "SUSPENDIDO" }, valorNuevo: { estado: "SUSPENDIDO" } });
  });

  it("BAJA is rejected before any hash or write", async () => {
    estadoActual = "BAJA";
    await expect(run()).rejects.toBeInstanceOf(DomainError);

    expect(restablecerPasswordTemporalMock).not.toHaveBeenCalled();
    expect(cambiarEstadoUsuarioMock).not.toHaveBeenCalled();
    expect(revokeAllSesionesMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("acting on yourself is rejected before any lock, hash or write", async () => {
    await expect(run({ usuarioId: ADMIN_ID })).rejects.toBeInstanceOf(DomainError);

    expect(lockMock).not.toHaveBeenCalled();
    expect(restablecerPasswordTemporalMock).not.toHaveBeenCalled();
    expect(revokeAllSesionesMock).not.toHaveBeenCalled();
  });

  it("CT1: neither the plaintext nor the hash reaches the audit row or the output", async () => {
    const output = await run();

    const hash = restablecerPasswordTemporalMock.mock.calls[0]![2] as string;
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toBe(PASSWORD_TEMPORAL);
    for (const text of [JSON.stringify(auditRecordMock.mock.calls), JSON.stringify(output)]) {
      expect(text).not.toContain(PASSWORD_TEMPORAL);
      expect(text).not.toContain(hash);
    }
    expect(auditInput()).toMatchObject({ accion: "RESTABLECER_CREDENCIAL", entidadId: TARGET_ID });
  });
});

describe("restablecerCredencial: temporary password validation", () => {
  it("rejects mismatched passwords on the repeat field", async () => {
    const error = await run({ passwordTemporalRepeat: "Otra-Distinta-2026" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((error as ValidationError).fields)).toContain("passwordTemporalRepeat");
    expect(restablecerPasswordTemporalMock).not.toHaveBeenCalled();
  });

  it("rejects a password that does not meet the policy on the password field", async () => {
    const error = await run({ passwordTemporal: "corta", passwordTemporalRepeat: "corta" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((error as ValidationError).fields)).toContain("passwordTemporal");
    expect(restablecerPasswordTemporalMock).not.toHaveBeenCalled();
  });

  it("rejects a 5-character password on the password field only", async () => {
    const error = await run({ passwordTemporal: "abc12", passwordTemporalRepeat: "abc12" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["passwordTemporal"]);
    expect(restablecerPasswordTemporalMock).not.toHaveBeenCalled();
  });

  it("accepts a 6-character lowercase password", async () => {
    await run({ passwordTemporal: "abc123", passwordTemporalRepeat: "abc123" });

    expect(restablecerPasswordTemporalMock).toHaveBeenCalledTimes(1);
  });
});

describe("restablecerCredencial: target is a cuenta de sector", () => {
  beforeEach(() => {
    loadUsuarioParaAccionMock.mockResolvedValue({
      id: TARGET_ID,
      estado: "ACTIVO",
      esTecnico: false,
      esSector: true,
      roles: ["FARMACEUTICO"],
      nombre: "Laboratorio",
      apellido: "(Sector)",
      email: "lab@farmacia.local",
      dni: "SECTOR-LAB",
      numeroMatricula: null,
    });
  });

  it("rejects a password that satisfies temporary policy but violates full password policy", async () => {
    const error = await run({ passwordTemporal: "abc123", passwordTemporalRepeat: "abc123" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["passwordTemporal"]);
    expect(restablecerPasswordTemporalMock).not.toHaveBeenCalled();
  });

  it("accepts a full-policy password, calls restablecerPasswordTemporal with debeCambiarPassword = false, and output includes esSector: true", async () => {
    const output = await run({ passwordTemporal: "ClaveSegura2026!", passwordTemporalRepeat: "ClaveSegura2026!" });

    expect(output).toEqual({ estado: "ACTIVO", esSector: true });
    expect(restablecerPasswordTemporalMock).toHaveBeenCalledTimes(1);
    const args = restablecerPasswordTemporalMock.mock.calls[0]!;
    expect(args[3]).toBe(false); // debeCambiarPassword = false
  });
});
