/**
 * M1 (security review) unit regression test.
 *
 * Confirmed defect: `crearUsuario` wrote exactly ONE `registro_auditoria`
 * row (`CREAR`, via `defineCommand`'s built-in single-row `audit` option),
 * with the initial roles only embedded inside that row's `valor_nuevo`
 * JSON. Plan §9 M03 historia 2 requires "auditoría `CREAR` + `ASIGNAR_ROL`"
 * -- one `ASIGNAR_ROL` row PER initial role, matching the discipline
 * `cambiarRoles` already uses for later role changes. Without a dedicated
 * `ASIGNAR_ROL` row per role, a query that looks up "when was role X
 * granted to usuario Y" (the natural shape for `cambiarRoles`-produced
 * history) silently misses every role granted at creation time.
 *
 * This is a stubbed-tx unit test: the repository functions
 * (`existeEmail`/`existeDni`/`insertUsuario`/`insertUsuarioRol`/
 * `insertCredencialActivacion`) are mocked so the handler runs with no
 * real database at all -- what this test proves is the SEQUENCE and SHAPE
 * of `auditRecord` calls the handler makes. tests/db/usuarios-admin.test.ts's
 * "M1: a crearUsuario-shaped insert..." test proves the same shape holds
 * for the real SQL/schema (registro_auditoria's NOT NULL/immutability
 * constraints, JSONB shape, etc.).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

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

const insertUsuarioRolMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  existeEmail: vi.fn(async () => false),
  existeDni: vi.fn(async () => false),
  insertUsuario: vi.fn(async () => ({ id: "nuevo-usuario-1" })),
  insertUsuarioRol: (...args: unknown[]) => insertUsuarioRolMock(...args),
  insertCredencialActivacion: vi.fn(async () => undefined),
}));

const { crearUsuarioCommand } = await import("@/modules/usuarios/application/crear-usuario");

function fakeSession(): AuthenticatedSession {
  return {
    usuario: { id: "admin-1", email: "admin@example.com", nombre: "A", apellido: "D" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(["usuarios.crear"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

beforeEach(() => {
  auditRecordMock.mockClear();
  insertUsuarioRolMock.mockClear();
});

describe("M1: crearUsuario audits CREAR + one ASIGNAR_ROL per initial role", () => {
  it("creating a user with 2 roles writes exactly 3 audit rows: 1 CREAR + 2 ASIGNAR_ROL, all for the new usuario, all in the same transaction", async () => {
    await crearUsuarioCommand.execute(
      { nombre: "Nueva", apellido: "Persona", email: "nueva@example.com", dni: "999", roles: ["FARMACEUTICO", "ATENCION_PUBLICO"] },
      { session: fakeSession() },
    );

    expect(auditRecordMock).toHaveBeenCalledTimes(3);

    const calls = auditRecordMock.mock.calls as Array<[unknown, Record<string, unknown>]>;
    const [txArg0, crear] = calls[0];
    expect(crear).toMatchObject({ entidad: "usuario", entidadId: "nuevo-usuario-1", accion: "CREAR" });

    const asignarRolCalls = calls.slice(1).map(([, input]) => input);
    expect(asignarRolCalls).toHaveLength(2);
    for (const call of asignarRolCalls) {
      expect(call).toMatchObject({ entidad: "usuario", entidadId: "nuevo-usuario-1", accion: "ASIGNAR_ROL" });
    }
    expect(asignarRolCalls.map((c) => (c.valorNuevo as { rol: string }).rol).sort()).toEqual(
      ["ATENCION_PUBLICO", "FARMACEUTICO"].sort(),
    );

    // Every audit call runs inside the SAME transaction the handler opened
    // (INV-A01: no write-then-audit two-step across transactions).
    for (const [tx] of calls) {
      expect(tx).toBe(txArg0);
    }

    // insertUsuarioRol (the actual role grant) was called once per role too.
    expect(insertUsuarioRolMock).toHaveBeenCalledTimes(2);
  });
});
