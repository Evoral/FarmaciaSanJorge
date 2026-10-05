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

  it("throws AuthorizationError without running the handler, and audits the denial (ACCESO_DENEGADO) in its own transaction", async () => {
    const handler = vi.fn(async () => ({ output: null }));
    const cmd = defineCommand({
      name: "test.denied",
      permiso: "usuarios.crear",
      input: z.object({}),
      audit: { skip: true, reason: "pipeline fixture: asserts ordering, writes nothing" },
      handler,
    });

    const session = fakeSession([]);
    await expect(cmd.execute({}, { session })).rejects.toBeInstanceOf(AuthorizationError);
    expect(handler).not.toHaveBeenCalled();
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      tenantId: session.tenantId,
      usuarioId: session.usuario.id,
      entidad: "acceso",
      entidadId: session.usuario.id,
      accion: "ACCESO_DENEGADO",
      valorNuevo: { casoDeUso: "test.denied", permiso: "usuarios.crear" },
    });
  });

  it("a failure to write the denial audit never masks the AuthorizationError", async () => {
    auditRecordMock.mockRejectedValueOnce(new Error("invalid input value for enum fsj.tipo_accion"));
    const cmd = defineCommand({
      name: "test.denied-audit-fails",
      permiso: "usuarios.crear",
      input: z.object({}),
      audit: { skip: true, reason: "pipeline fixture: asserts ordering, writes nothing" },
      handler: async () => ({ output: null }),
    });

    await expect(cmd.execute({}, { session: fakeSession([]) })).rejects.toBeInstanceOf(AuthorizationError);
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

  it("the ValidationError message names each field by its human label (never the raw key), and root issues get no prefix", async () => {
    const cmd = defineCommand({
      name: "test.validate-labels",
      permiso: "usuarios.crear",
      input: z
        .object({
          numeroMatricula: z.string().min(1, "Este campo no puede estar vacío."),
          roles: z.array(z.string()).min(1, "Elegí al menos un rol."),
        })
        .refine(() => false, "Revisá los datos ingresados."),
      audit: { skip: true, reason: "pipeline fixture: asserts message format, writes nothing" },
      handler: async () => ({ output: null }),
    });

    await expect(cmd.execute({ numeroMatricula: "", roles: [] }, { session: fakeSession(["usuarios.crear"]) })).rejects.toThrow(
      "Datos inválidos: Matrícula: Este campo no puede estar vacío.; Roles: Elegí al menos un rol.",
    );
    // A refine on the root object only runs once the shape itself is valid.
    await expect(cmd.execute({ numeroMatricula: "MP-1", roles: ["ADMIN"] }, { session: fakeSession(["usuarios.crear"]) })).rejects.toThrow(
      /^Datos inválidos: Revisá los datos ingresados\.$/,
    );
  });

  it("the ValidationError carries the distinct top-level field names with an issue (root issues add none)", async () => {
    const cmd = defineCommand({
      name: "test.validate-fields",
      permiso: "usuarios.crear",
      input: z
        .object({
          numeroMatricula: z.string().min(1).max(3),
          version: z.object({ nombre: z.string().min(1), apellido: z.string().min(1) }),
          roles: z.array(z.string()),
        })
        .refine(() => false, "Revisá los datos ingresados."),
      audit: { skip: true, reason: "pipeline fixture: asserts error fields, writes nothing" },
      handler: async () => ({ output: null }),
    });

    const shapeError = await cmd.execute({ numeroMatricula: "", version: { nombre: "", apellido: "" }, roles: [] }, { session: fakeSession(["usuarios.crear"]) }).catch((e: unknown) => e);
    expect(shapeError).toBeInstanceOf(ValidationError);
    expect((shapeError as ValidationError).fields).toEqual(["numeroMatricula", "version"]);

    const rootError = await cmd.execute({ numeroMatricula: "MP", version: { nombre: "a", apellido: "b" }, roles: [] }, { session: fakeSession(["usuarios.crear"]) }).catch((e: unknown) => e);
    expect(rootError).toBeInstanceOf(ValidationError);
    expect((rootError as ValidationError).fields).toBeUndefined();
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

describe("defineQuery prepare step (opt-in, runs outside any transaction)", () => {
  it("runs requireSession -> authorize -> parse -> prepare -> transaction -> handler, in that order", async () => {
    const callLog: string[] = [];
    withTenantTransactionMock.mockImplementationOnce(async (tenantId: string, fn: (tx: unknown) => unknown) => {
      callLog.push("transaction");
      lastFakeTx = { __fakeTx: true, tenantId };
      return fn(lastFakeTx);
    });
    requireSessionMock.mockImplementationOnce(async () => {
      callLog.push("requireSession");
      return fakeSession(["recetas.crear"]);
    });
    const query = defineQuery({
      name: "test.prepare-order",
      permiso: "recetas.crear",
      input: z.object({ qr: z.string() }),
      prepare: async () => {
        callLog.push("prepare");
        return { fetched: true };
      },
      handler: async () => {
        callLog.push("handler");
        return "ok";
      },
    });

    await expect(query.execute({ qr: "x" })).resolves.toBe("ok");
    expect(callLog).toEqual(["requireSession", "prepare", "transaction", "handler"]);
  });

  it("hands prepare the session and the PARSED input, and passes its result to the handler as `prepared`", async () => {
    const session = fakeSession(["recetas.crear"]);
    const prepare = vi.fn(async ({ input }: { session: AuthenticatedSession; input: { qr: string } }) => ({ largo: input.qr.length }));
    const handler = vi.fn(async ({ prepared, input }: { prepared: { largo: number }; input: { qr: string } }) => `${input.qr}:${prepared.largo}`);
    const query = defineQuery({
      name: "test.prepare-result",
      permiso: "recetas.crear",
      input: z.object({ qr: z.string().trim() }),
      prepare,
      handler,
    });

    // The zod `trim()` transform proves prepare receives the parsed input, not the raw one.
    await expect(query.execute({ qr: "  abc  " }, { session })).resolves.toBe("abc:3");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith({ session, input: { qr: "abc" } });
    expect(handler.mock.calls[0]![0]).toMatchObject({ prepared: { largo: 3 }, input: { qr: "abc" }, session });
  });

  it("opens no transaction while prepare is running (the transaction starts only after prepare resolves)", async () => {
    let transactionsDuringPrepare = -1;
    const query = defineQuery({
      name: "test.prepare-outside-tx",
      permiso: "recetas.crear",
      input: z.object({}),
      prepare: async () => {
        transactionsDuringPrepare = withTenantTransactionMock.mock.calls.length;
        return null;
      },
      handler: async () => "ok",
    });

    await query.execute({}, { session: fakeSession(["recetas.crear"]) });
    expect(transactionsDuringPrepare).toBe(0);
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("a denied session throws AuthorizationError BEFORE prepare is called (only the denial audit transaction opens)", async () => {
    const prepare = vi.fn(async () => "never");
    const handler = vi.fn(async () => "never");
    const query = defineQuery({
      name: "test.prepare-denied",
      permiso: "recetas.crear",
      input: z.object({}),
      prepare,
      handler,
    });

    await expect(query.execute({}, { session: fakeSession([]) })).rejects.toBeInstanceOf(AuthorizationError);
    expect(prepare).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(1); // the ACCESO_DENEGADO audit, nothing else
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ accion: "ACCESO_DENEGADO" });
  });

  it("a zod failure throws ValidationError BEFORE prepare is called and opens no transaction", async () => {
    const prepare = vi.fn(async () => "never");
    const query = defineQuery({
      name: "test.prepare-invalid-input",
      permiso: "recetas.crear",
      input: z.object({ qr: z.string().min(1) }),
      prepare,
      handler: async () => "never",
    });

    await expect(query.execute({ qr: "" }, { session: fakeSession(["recetas.crear"]) })).rejects.toBeInstanceOf(ValidationError);
    expect(prepare).not.toHaveBeenCalled();
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
  });

  it("a throwing prepare propagates its error, never runs the handler and opens no transaction", async () => {
    const handler = vi.fn(async () => "never");
    const query = defineQuery({
      name: "test.prepare-throws",
      permiso: "recetas.crear",
      input: z.object({}),
      prepare: async () => {
        throw new Error("upstream unavailable");
      },
      handler,
    });

    await expect(query.execute({}, { session: fakeSession(["recetas.crear"]) })).rejects.toThrow("upstream unavailable");
    expect(handler).not.toHaveBeenCalled();
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
  });

  it("a query without prepare behaves as before: the handler sees `prepared` undefined and one transaction opens", async () => {
    const session = fakeSession(["usuarios.listar"]);
    const handler = vi.fn(async ({ input }: { input: { n: number } }) => input.n + 1);
    const query = defineQuery({
      name: "test.no-prepare",
      permiso: "usuarios.listar",
      input: z.object({ n: z.number() }),
      handler,
    });

    await expect(query.execute({ n: 1 }, { session })).resolves.toBe(2);
    expect(handler.mock.calls[0]![0]).toMatchObject({ input: { n: 1 }, session, prepared: undefined });
    expect(handler.mock.calls[0]![0]).toHaveProperty("prepared");
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(1);
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

    // None of the enumerated use cases ran: the only writes are their ACCESO_DENEGADO audit rows.
    expect(auditRecordMock).toHaveBeenCalledTimes(registered.length);
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(registered.length);
    for (const call of auditRecordMock.mock.calls) {
      expect(call[1]).toMatchObject({ accion: "ACCESO_DENEGADO", entidad: "acceso" });
    }
  });
});
