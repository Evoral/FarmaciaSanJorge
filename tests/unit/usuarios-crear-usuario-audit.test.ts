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
 * (`existeEmail`/`existeDni`/`insertUsuario`/`insertUsuarioRol`) are mocked so the handler runs with no
 * real database at all -- what this test proves is the SEQUENCE and SHAPE
 * of `auditRecord` calls the handler makes. tests/db/usuarios-admin.test.ts's
 * "M1: a crearUsuario-shaped insert..." test proves the same shape holds
 * for the real SQL/schema (registro_auditoria's NOT NULL/immutability
 * constraints, JSONB shape, etc.).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/shared/errors";
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

const insertUsuarioMock = vi.fn(async (...args: unknown[]): Promise<{ id: string }> => {
  void args;
  return { id: "nuevo-usuario-1" };
});
const insertUsuarioRolMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  existeEmail: vi.fn(async () => false),
  existeDni: vi.fn(async () => false),
  insertUsuario: (...args: unknown[]) => insertUsuarioMock(...args),
  insertUsuarioRol: (...args: unknown[]) => insertUsuarioRolMock(...args),
}));

// DP-03: crearUsuario resolves the submitted codes against the tenant's roles first (roles-asignables.ts).
vi.mock("@/modules/usuarios/infrastructure/rol-repository", () => ({
  findRolesPorCodigo: vi.fn(async (_tx: unknown, _tenantId: string, codigos: string[]) =>
    codigos.map((codigo) => ({ id: `rol-${codigo}`, codigo, nombre: codigo, esAdministrador: false, permisos: [] })),
  ),
  codigosDeRolesDelUsuario: vi.fn(async () => ["ADMINISTRADOR"]),
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
  insertUsuarioMock.mockClear();
  insertUsuarioRolMock.mockClear();
});

const PASSWORD_TEMPORAL = "Temporal-Segura-2026";
const passwordFields = { passwordTemporal: PASSWORD_TEMPORAL, passwordTemporalRepeat: PASSWORD_TEMPORAL };
const persona = { nombre: "Nueva", apellido: "Persona", email: "nueva@example.com", dni: "999", roles: ["FARMACEUTICO"] };

describe("M1: crearUsuario audits CREAR + one ASIGNAR_ROL per initial role", () => {
  it("creating a user with 2 roles writes exactly 3 audit rows: 1 CREAR + 2 ASIGNAR_ROL, all for the new usuario, all in the same transaction", async () => {
    await crearUsuarioCommand.execute(
      { ...persona, roles: ["FARMACEUTICO", "ATENCION_PUBLICO"], ...passwordFields },
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

describe("crearUsuario: temporary password", () => {
  it("stores only an argon2id hash: the plaintext and the hash never reach the audit rows nor the output", async () => {
    const output = await crearUsuarioCommand.execute({ ...persona, ...passwordFields }, { session: fakeSession() });

    expect(insertUsuarioMock).toHaveBeenCalledTimes(1);
    const { passwordHash } = insertUsuarioMock.mock.calls[0]![1] as { passwordHash: string };
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toBe(PASSWORD_TEMPORAL);

    const audited = JSON.stringify(auditRecordMock.mock.calls);
    const returned = JSON.stringify(output);
    for (const text of [audited, returned]) {
      expect(text).not.toContain(PASSWORD_TEMPORAL);
      expect(text).not.toContain(passwordHash);
    }
  });

  it("outputs only the new usuario id (no activation credential)", async () => {
    const output = await crearUsuarioCommand.execute({ ...persona, ...passwordFields }, { session: fakeSession() });
    expect(output).toEqual({ usuarioId: "nuevo-usuario-1" });
  });

  const sector = { nombre: "Laboratorio", email: "lab@farmacia.local", roles: ["FARMACEUTICO"], esSector: true };
  it.each([
    ["a person", persona],
    ["a cuenta de sector", sector],
  ])("rejects mismatched passwords for %s, marking the repeat field", async (_label, base) => {
    const error = await crearUsuarioCommand
      .execute({ ...base, passwordTemporal: PASSWORD_TEMPORAL, passwordTemporalRepeat: `${PASSWORD_TEMPORAL}x` }, { session: fakeSession() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["passwordTemporalRepeat"]);
    expect(insertUsuarioMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a person", persona],
    ["a cuenta de sector", sector],
  ])("rejects a policy-violating password for %s, marking the password field", async (_label, base) => {
    const error = await crearUsuarioCommand
      .execute({ ...base, passwordTemporal: "corta", passwordTemporalRepeat: "corta" }, { session: fakeSession() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["passwordTemporal"]);
    expect(insertUsuarioMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a person", persona],
    ["a cuenta de sector", sector],
  ])("accepts a 6-character lowercase temporary password for %s", async (_label, base) => {
    await crearUsuarioCommand.execute({ ...base, passwordTemporal: "abc123", passwordTemporalRepeat: "abc123" }, { session: fakeSession() });
    expect(insertUsuarioMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a person", persona],
    ["a cuenta de sector", sector],
  ])("rejects a 5-character temporary password for %s, marking only the password field", async (_label, base) => {
    const error = await crearUsuarioCommand
      .execute({ ...base, passwordTemporal: "abc12", passwordTemporalRepeat: "abc12" }, { session: fakeSession() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["passwordTemporal"]);
    expect(insertUsuarioMock).not.toHaveBeenCalled();
  });
});
