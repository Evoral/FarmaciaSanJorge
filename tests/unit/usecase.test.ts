/**
 * Unit tests for shared/usecase.ts's pipeline (FASE 2 point 2.7).
 *
 * `@/shared/db/transaction` and `@/shared/audit` are mocked so these tests
 * run with no DB connection at all -- the DB-level guarantees (RLS,
 * atomicity, immutability) are already covered by tests/db/*. What these
 * tests prove instead is that shared/usecase.ts wires the pipeline
 * correctly: requireSession -> authorize -> zod.parse -> transaction ->
 * handler -> audit (same tx) -> mapDbError, and that every use case
 * created through defineCommand/defineQuery is structurally forced through
 * authorize() -- there is no other way to invoke one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AuthorizationError, ValidationError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
}));

let lastFakeTx: unknown;
const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => {
  lastFakeTx = { __fakeTx: true, tenantId };
  return fn(lastFakeTx);
});
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

const requireSessionMock = vi.fn(async (): Promise<AuthenticatedSession> => {
  throw new Error("requireSession() unexpectedly called -- this test should inject a session via execute(input, { session })");
});
vi.mock("@/shared/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

// Imported AFTER the mocks above (vi.mock calls are hoisted by Vitest, so
// this ordering in source is just for readability, not correctness).
const { defineCommand, defineQuery, listRegisteredUseCases, listRegisteredUseCasesForTests, resetUsecaseRegistryForTests } =
  await import("@/shared/usecase");

function fakeSession(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "usuario-1", email: "a@example.com", nombre: "A", apellido: "B" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "sesion-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: null,
  };
}

beforeEach(() => {
  resetUsecaseRegistryForTests();
  auditRecordMock.mockClear();
  withTenantTransactionMock.mockClear();
  requireSessionMock.mockClear();
});

describe("defineCommand", () => {
  it("registers itself with kind/name/permiso", () => {
    defineCommand({
      name: "test.command",
      permiso: "usuarios.crear",
      input: z.object({ nombre: z.string() }),
      audit: { entidad: "usuario", accion: "CREAR" },
      handler: async ({ input }) => ({ output: input, audit: { entidadId: "x" } }),
    });
    expect(listRegisteredUseCases()).toEqual([{ kind: "command", name: "test.command", permiso: "usuarios.crear" }]);
  });

  it("runs authorize -> parse -> transaction -> handler -> audit(same tx), in that order, with an injected session", async () => {
    const cmd = defineCommand({
      name: "test.order",
      permiso: "usuarios.crear",
      input: z.object({ nombre: z.string() }),
      audit: { entidad: "usuario", accion: "CREAR" },
      handler: async ({ tx, input }) => {
        expect(tx).toBe(lastFakeTx); // handler runs inside the opened transaction
        return { output: { ok: true }, audit: { entidadId: "entity-1", valorNuevo: input } };
      },
    });

    const session = fakeSession(["usuarios.crear"]);
    const result = await cmd.execute({ nombre: "Juan" }, { session });

    expect(result).toEqual({ ok: true });
    expect(requireSessionMock).not.toHaveBeenCalled(); // session was injected, not read from a cookie
    expect(withTenantTransactionMock).toHaveBeenCalledWith(session.tenantId, expect.any(Function));
    expect(auditRecordMock).toHaveBeenCalledTimes(1);

    const [tx, auditInput] = auditRecordMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(tx).toBe(lastFakeTx); // audit write lands in the SAME transaction as the handler
    expect(auditInput).toMatchObject({
      tenantId: session.tenantId,
      usuarioId: session.usuario.id, // sourced from the session, not from input
      entidad: "usuario",
      entidadId: "entity-1",
      accion: "CREAR",
    });
  });

  it("calls the real requireSession() when no session is injected", async () => {
    requireSessionMock.mockResolvedValueOnce(fakeSession(["usuarios.crear"]));
    const cmd = defineCommand({
      name: "test.real-session",
      permiso: "usuarios.crear",
      input: z.object({}),
      audit: { skip: true, reason: "pipeline fixture: asserts ordering, writes nothing" },
      handler: async () => ({ output: "ok" }),
    });

    await expect(cmd.execute({})).resolves.toBe("ok");
    expect(requireSessionMock).toHaveBeenCalledTimes(1);
  });

  it("throws AuthorizationError before opening a transaction when the session lacks the permission", async () => {
    const cmd = defineCommand({
      name: "test.denied",
      permiso: "usuarios.crear",
      input: z.object({}),
      audit: { skip: true, reason: "pipeline fixture: asserts ordering, writes nothing" },
      handler: async () => ({ output: null }),
    });

    await expect(cmd.execute({}, { session: fakeSession([]) })).rejects.toBeInstanceOf(AuthorizationError);
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("maps a zod parse failure to ValidationError (not a raw ZodError), after authorize but before opening a transaction", async () => {
    const cmd = defineCommand({
      name: "test.validate",
      permiso: "usuarios.crear",
      input: z.object({ nombre: z.string().min(1) }),
      audit: { skip: true, reason: "pipeline fixture: asserts ordering, writes nothing" },
      handler: async () => ({ output: null }),
    });

    await expect(cmd.execute({ nombre: "" }, { session: fakeSession(["usuarios.crear"]) })).rejects.toBeInstanceOf(ValidationError);
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
  });

  it("throws if audit is declared but the handler omits audit data -- forgetting auditing cannot slip through silently", async () => {
    const cmd = defineCommand({
      name: "test.forgot-audit",
      permiso: "usuarios.crear",
      input: z.object({}),
      audit: { entidad: "usuario", accion: "CREAR" },
      // Simulates a handler author forgetting the `audit` field.
      handler: async () => ({ output: null }) as { output: null; audit?: never },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await expect(cmd.execute({}, { session: fakeSession(["usuarios.crear"]) })).rejects.toThrow(/did not return audit data/);
  });

  it("audit: { skip: true } never calls audit.record", async () => {
    const cmd = defineCommand({
      name: "test.skip-audit",
      permiso: "usuarios.crear",
      input: z.object({}),
      audit: { skip: true, reason: "read-modeling only, nothing to audit" },
      handler: async () => ({ output: "done" }),
    });

    await cmd.execute({}, { session: fakeSession(["usuarios.crear"]) });
    expect(auditRecordMock).not.toHaveBeenCalled();
  });
});

describe("defineQuery", () => {
  it("registers itself, authorizes, and runs inside a tenant transaction without ever auditing", async () => {
    const query = defineQuery({
      name: "test.query",
      permiso: "usuarios.listar",
      input: z.object({}),
      handler: async ({ session }) => [session.usuario.id],
    });

    expect(listRegisteredUseCases()).toContainEqual({ kind: "query", name: "test.query", permiso: "usuarios.listar" });

    const session = fakeSession(["usuarios.listar"]);
    const result = await query.execute({}, { session });
    expect(result).toEqual([session.usuario.id]);
    expect(withTenantTransactionMock).toHaveBeenCalledWith(session.tenantId, expect.any(Function));
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("denies a session without the permission", async () => {
    const query = defineQuery({
      name: "test.query-denied",
      permiso: "usuarios.listar",
      input: z.object({}),
      handler: async () => [],
    });
    await expect(query.execute({}, { session: fakeSession([]) })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("every registered use case is structurally forced through authorize()", () => {
  it("rejects a permissionless session for EVERY currently registered use case", async () => {
    defineCommand({
      name: "enum.command.a",
      permiso: "drogas.crear",
      input: z.object({}),
      audit: { skip: true, reason: "registry fixture: asserts authorize runs first" },
      handler: async () => ({ output: null }),
    });
    defineCommand({
      name: "enum.command.b",
      permiso: "stock.ajuste.autorizar",
      input: z.object({}),
      audit: { entidad: "movimiento_stock", accion: "AUTORIZAR" },
      handler: async () => ({ output: null, audit: { entidadId: "irrelevant" } }),
    });
    defineQuery({
      name: "enum.query.a",
      permiso: "stock.ver",
      input: z.object({}),
      handler: async () => null,
    });

    const registered = listRegisteredUseCasesForTests();
    expect(registered.length).toBe(3);

    const noPermisos = fakeSession([]);
    for (const entry of registered) {
      expect(entry.permiso, `use case "${entry.name}" registered with an empty permiso`).toBeTruthy();
      await expect(
        entry.execute({}, { session: noPermisos }),
        `use case "${entry.name}" did not call authorize() -- it should have rejected a permissionless session`,
      ).rejects.toBeInstanceOf(AuthorizationError);
    }

    // None of the enumerated use cases should have reached the transaction/audit steps.
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });
});
