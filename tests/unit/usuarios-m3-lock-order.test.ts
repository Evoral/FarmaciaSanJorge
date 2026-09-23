/**
 * M3 (security review) unit regression test.
 *
 * Confirmed defect: `cambiarEstadoUsuario`'s callers (suspender/reactivar/
 * baja/restablecerCredencial) used to read `actual` (the source of
 * `estadoAnterior` for BOTH `usuario_estado_historial` and the
 * `registro_auditoria.valor_anterior`) via an UNLOCKED
 * `loadUsuarioParaAccion` call, before doing any row locking. Under
 * concurrency, that read can be stale by the time this transaction's write
 * lands -- the audit trail then records a "before" state that never was
 * the true immediately-preceding state, corrupting the legally relevant
 * history (see those four commands' doc comments, and
 * admin-guard.ts#lockUsuarioYAdministradoresActivos's doc comment, for the
 * full two-admin race).
 *
 * The fix: lock the target row FIRST
 * (`lockUsuarioYAdministradoresActivos`), then read it. This test proves
 * exactly that, at the unit level (mocked repository/admin-guard, no DB --
 * tests/db/usuarios-admin.test.ts covers the real SQL shape):
 *   1. `lockUsuarioYAdministradoresActivos` is called BEFORE
 *      `loadUsuarioParaAccion` (call order).
 *   2. The audit row's `valorAnterior` reflects EXACTLY what the (locked)
 *      read returned -- SUSPENDIDO in this test -- and not some other,
 *      earlier value (ACTIVO) that a stale/unlocked read could have
 *      produced instead.
 *
 * Exercised against `restablecerCredencial`: unlike
 * suspender/reactivar/darDeBaja, it accepts ANY pre-BAJA estado, so this
 * isolates the M3 lock-then-read concern from those commands' OWN
 * state-machine gating (which would otherwise force a specific "before"
 * state just to keep the command from throwing a DIFFERENT, unrelated
 * DomainError first).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

const TARGET_ID = "22222222-2222-4222-a222-222222222222";

const callOrder: string[] = [];

const lockMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lock");
  return { targetLocked: true, idsAdminsActivos: [] };
});
vi.mock("@/modules/usuarios/infrastructure/admin-guard", () => ({
  lockUsuarioYAdministradoresActivos: (...args: unknown[]) => lockMock(...args),
}));

const loadUsuarioParaAccionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("read");
  // The LOCKED snapshot -- deliberately SUSPENDIDO, simulating a
  // concurrent SUSPENDER that committed between what an (earlier,
  // now-removed) unlocked read would have seen and this locked read.
  return {
    id: TARGET_ID,
    estado: "SUSPENDIDO",
    esTecnico: false,
    roles: ["FARMACEUTICO"],
    nombre: "N",
    apellido: "A",
    email: "n@example.com",
    dni: "1",
    numeroMatricula: null,
  };
});
const cambiarEstadoUsuarioMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
const revokeCredencialesActivasMock = vi.fn(async (...args: unknown[]): Promise<number> => {
  void args;
  return 0;
});
const insertCredencialActivacionMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  loadUsuarioParaAccion: (...args: unknown[]) => loadUsuarioParaAccionMock(...args),
  cambiarEstadoUsuario: (...args: unknown[]) => cambiarEstadoUsuarioMock(...args),
  revokeCredencialesActivas: (...args: unknown[]) => revokeCredencialesActivasMock(...args),
  insertCredencialActivacion: (...args: unknown[]) => insertCredencialActivacionMock(...args),
}));

vi.mock("@/modules/auth/application/revoke-session", () => ({
  revokeAllSesionesForUsuarioInTx: vi.fn(async () => 0),
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

function fakeSession(): AuthenticatedSession {
  return {
    usuario: { id: "admin-1", email: "admin@example.com", nombre: "A", apellido: "D" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(["usuarios.credencial.restablecer"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

beforeEach(() => {
  callOrder.length = 0;
  lockMock.mockClear();
  loadUsuarioParaAccionMock.mockClear();
  cambiarEstadoUsuarioMock.mockClear();
  auditRecordMock.mockClear();
});

describe("M3: restablecerCredencial derives estadoAnterior from the LOCKED read, not an earlier snapshot", () => {
  it("locks the target row BEFORE reading it, and the audit row's valorAnterior reflects the LOCKED read's estado", async () => {
    await restablecerCredencialCommand.execute({ usuarioId: TARGET_ID }, { session: fakeSession() });

    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(loadUsuarioParaAccionMock).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["lock", "read"]); // lock BEFORE read -- the M3 fix.

    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    const [, auditInput] = auditRecordMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    // The locked read said SUSPENDIDO -- the audit row must say SUSPENDIDO,
    // never ACTIVO (what a stale, pre-lock snapshot could have said).
    expect(auditInput.valorAnterior).toEqual({ estado: "SUSPENDIDO" });
    expect(auditInput.valorAnterior).not.toEqual({ estado: "ACTIVO" });

    expect(cambiarEstadoUsuarioMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estadoAnterior: "SUSPENDIDO", estadoNuevo: "PENDIENTE_ACTIVACION" }),
    );
  });
});
