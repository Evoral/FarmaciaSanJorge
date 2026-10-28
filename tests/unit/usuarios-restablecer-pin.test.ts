/**
 * Unit tests for `restablecerPin` (docs/specs/restablecer-pin.md): stubbed tx,
 * mocked repository, same style as tests/unit/contrasena-temporal-restablecer.test.ts.
 *
 *   RP2: not on yourself, rejected before any lock or write.
 *   RP3: BAJA, cuenta de sector, admin-only and no-PIN targets are rejected before any write.
 *   RP4: the valid case clears the PIN columns only (`limpiarPin`).
 *   RP6: the target row is locked before it is read.
 *   RP7: audited as RESTABLECER_CREDENCIAL, never with a PIN or its hash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DomainError, NotFoundError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";

const TARGET_ID = "22222222-2222-4222-a222-222222222222";
const ADMIN_ID = "33333333-3333-4333-a333-333333333333";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface Target {
  id: string;
  estado: string;
  esSector: boolean;
  soloAdministrador: boolean;
  tienePin: boolean;
  pinBloqueado: boolean;
}

const baseTarget: Target = { id: TARGET_ID, estado: "ACTIVO", esSector: false, soloAdministrador: false, tienePin: true, pinBloqueado: false };
let target: Target | null = { ...baseTarget };
const calls: string[] = [];

const lockMock = vi.fn(async (...args: unknown[]) => {
  void args;
  calls.push("lock");
  return { targetLocked: true, idsAdminsActivos: [] };
});
vi.mock("@/modules/usuarios/infrastructure/admin-guard", () => ({
  lockUsuarioYAdministradoresActivos: (...args: unknown[]) => lockMock(...args),
}));

const loadMock = vi.fn(async (...args: unknown[]) => {
  void args;
  calls.push("load");
  return target;
});
const limpiarPinMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  calls.push("limpiarPin");
  return undefined;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  loadUsuarioParaRestablecerPin: (...args: unknown[]) => loadMock(...args),
  limpiarPin: (...args: unknown[]) => limpiarPinMock(...args),
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

const { restablecerPinCommand } = await import("@/modules/usuarios/application/restablecer-pin");

function fakeSession(usuarioId = ADMIN_ID): AuthenticatedSession {
  return {
    usuario: { id: usuarioId, email: "admin@example.com", nombre: "A", apellido: "D" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(["usuarios.credencial.restablecer"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

function run(usuarioId = TARGET_ID, session = fakeSession()) {
  return restablecerPinCommand.execute({ usuarioId }, { session });
}

function auditInput(): Record<string, unknown> {
  return (auditRecordMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
}

beforeEach(() => {
  target = { ...baseTarget };
  calls.length = 0;
  for (const mock of [lockMock, loadMock, limpiarPinMock, auditRecordMock]) mock.mockClear();
});

describe("restablecerPin: clears the PIN", () => {
  it("RP4/RP6: locks, then reads, then clears the PIN of the target only", async () => {
    const output = await run();

    expect(output).toEqual({});
    expect(calls).toEqual(["lock", "load", "limpiarPin"]);
    expect(lockMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, TARGET_ID]);
    expect(loadMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, TARGET_ID]);
    const args = limpiarPinMock.mock.calls[0]!;
    expect(args).toHaveLength(3); // (tx, usuarioId, now): nothing else is written
    expect(args[1]).toBe(TARGET_ID);
    expect(args[2]).toBeInstanceOf(Date);
  });

  it("a blocked PIN is reset too, and the audit records that it was blocked", async () => {
    target = { ...baseTarget, pinBloqueado: true };
    await run();

    expect(limpiarPinMock).toHaveBeenCalledTimes(1);
    expect(auditInput()).toMatchObject({ valorAnterior: { pinBloqueado: true } });
  });

  it("RP7: audited as RESTABLECER_CREDENCIAL with its own motivo and no PIN data", async () => {
    await run();

    expect(auditInput()).toMatchObject({
      accion: "RESTABLECER_CREDENCIAL",
      entidad: "usuario",
      entidadId: TARGET_ID,
      motivo: "Restablecimiento de PIN por el Administrador.",
      valorAnterior: { pinBloqueado: false },
      valorNuevo: { pin: "restablecido", pinBloqueado: false },
    });
    expect(JSON.stringify(auditRecordMock.mock.calls)).not.toMatch(/pinHash|argon2/);
  });
});

describe("restablecerPin: rejections", () => {
  it("RP2: acting on yourself is rejected before any lock or write", async () => {
    const error = await run(ADMIN_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as Error).message).toContain("Mi cuenta");
    expect(lockMock).not.toHaveBeenCalled();
    expect(limpiarPinMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("a nonexistent (or technical) usuario is not found", async () => {
    target = null;
    await expect(run()).rejects.toBeInstanceOf(NotFoundError);
    expect(limpiarPinMock).not.toHaveBeenCalled();
  });

  const casos: Array<{ nombre: string; cambio: Partial<Target>; mensaje: string }> = [
    { nombre: "BAJA", cambio: { estado: "BAJA" }, mensaje: "dado de baja" },
    { nombre: "a cuenta de sector", cambio: { esSector: true, tienePin: false }, mensaje: "Las cuentas de sector no usan PIN." },
    { nombre: "an admin-only usuario", cambio: { soloAdministrador: true, tienePin: false }, mensaje: "El Administrador no usa PIN." },
    { nombre: "a usuario without a PIN (e.g. a second click)", cambio: { tienePin: false }, mensaje: "El usuario no tiene un PIN configurado." },
    { nombre: "a SUSPENDIDO usuario (its PIN was cleared on suspension)", cambio: { estado: "SUSPENDIDO", tienePin: false }, mensaje: "El usuario no tiene un PIN configurado." },
  ];

  for (const { nombre, cambio, mensaje } of casos) {
    it(`RP3: ${nombre} is rejected after the lock and before any write`, async () => {
      target = { ...baseTarget, ...cambio };
      const error = await run().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect((error as Error).message).toContain(mensaje);
      expect(lockMock).toHaveBeenCalledTimes(1);
      expect(limpiarPinMock).not.toHaveBeenCalled();
      expect(auditRecordMock).not.toHaveBeenCalled();
    });
  }
});
