/**
 * `replaceMetodosHabilitados` / `lockMetodosHabilitados` (modules/operadores/infrastructure/operadores-repository.ts,
 * openspec/changes/metodos-verificacion-operador):
 *
 *   - concurrent saves of a farmacia's set are serialized by a per-tenant advisory lock taken before the delete + insert
 *     (without it, two saves both delete and both insert the same pair, and one fails on the primary key);
 *   - the write touches ONLY `metodo_verificacion_habilitado`: disabling a method keeps the enrolled credentials, which
 *     work again when it is switched back on (spec "Conservación de los códigos al deshabilitar un método").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { lockMetodosHabilitados, replaceMetodosHabilitados } from "@/modules/operadores/infrastructure/operadores-repository";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const llamadas: string[] = [];

const executeRawMock = vi.fn((strings: TemplateStringsArray, ...valores: unknown[]) => {
  llamadas.push(`lock:${strings.join("?")}|${valores.join(",")}`);
  return Promise.resolve(1);
});
const deleteManyMock = vi.fn(async (...args: unknown[]) => {
  void args;
  llamadas.push("deleteMany");
  return { count: 1 };
});
const createManyMock = vi.fn(async (...args: unknown[]) => {
  void args;
  llamadas.push("createMany");
  return { count: 1 };
});

/** Any access to another table (the credentials, the usuarios) fails the test. */
const tx = new Proxy(
  {
    $executeRaw: executeRawMock,
    metodoVerificacionHabilitado: { deleteMany: deleteManyMock, createMany: createManyMock },
  },
  {
    get(destino, propiedad) {
      if (propiedad in destino) return (destino as Record<string | symbol, unknown>)[propiedad];
      throw new Error(`unexpected access to tx.${String(propiedad)}`);
    },
  },
) as unknown as Prisma.TransactionClient;

beforeEach(() => {
  llamadas.length = 0;
  executeRawMock.mockClear();
  deleteManyMock.mockClear();
  createManyMock.mockClear();
});

describe("replaceMetodosHabilitados", () => {
  it("takes the per-tenant advisory lock before deleting and inserting", async () => {
    await replaceMetodosHabilitados(tx, TENANT_ID, ["HUELLA"]);

    expect(llamadas).toHaveLength(3);
    expect(llamadas[0]).toContain("pg_advisory_xact_lock(hashtext('fsj.metodos:'");
    expect(llamadas[0]).toContain(TENANT_ID);
    expect(llamadas.slice(1)).toEqual(["deleteMany", "createMany"]);
    expect(createManyMock).toHaveBeenCalledWith({ data: [{ tenantId: TENANT_ID, metodo: "HUELLA" }] });
  });

  it("disabling every optional method only deletes the config rows: no credential is read or written", async () => {
    await replaceMetodosHabilitados(tx, TENANT_ID, []);

    expect(deleteManyMock).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    expect(createManyMock).not.toHaveBeenCalled();
    // `tx` throws on any access to tx.credencialOperador: reaching this line proves it was never touched.
  });

  it("the lock is re-entrant: the command takes it first and the replace takes it again", async () => {
    await lockMetodosHabilitados(tx, TENANT_ID);
    await replaceMetodosHabilitados(tx, TENANT_ID, []);
    expect(executeRawMock).toHaveBeenCalledTimes(2);
  });
});
