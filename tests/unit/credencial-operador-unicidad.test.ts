/**
 * Uniqueness of a secret code per farmacia and per method, for the methods stored in `fsj.credencial_operador`
 * (openspec/changes/metodos-verificacion-operador, spec "Unicidad de PIN por farmacia"): the real credential source and
 * the real strategy against a fake transaction.
 *
 *   - the check takes the per-method, per-tenant advisory lock BEFORE reading the other hashes;
 *   - it only reads that method's credentials of the OTHER usuarios of the same tenant, so the same text as another
 *     empleado's PIN, or as the usuario's own PIN, is accepted (the PIN is never read);
 *   - the rejection carries the method's message on its field and never says whose code it is.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { ValidationError } from "@/shared/errors";

const verifyPasswordMock = vi.fn(async (hash: string, plain: string): Promise<boolean> => hash === `hash:${plain}`);
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (hash: string, plain: string) => verifyPasswordMock(hash, plain),
}));

const { fuenteDeCredencial } = await import("@/modules/auth/application/identificador-credencial");
const { assertCodigoDisponible } = await import("@/modules/auth/application/identificacion-por-codigo");
const { REGISTRO } = await import("@/modules/auth/application/metodos-verificacion");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-4222-a222-222222222222";
const llamadas: string[] = [];

const executeRawMock = vi.fn((strings: TemplateStringsArray, ...valores: unknown[]) => {
  llamadas.push(`lock:${strings.join("?")}|${valores.join(",")}`);
  return Promise.resolve(1);
});
const findManyMock = vi.fn(async (...args: unknown[]): Promise<{ hash: string }[]> => {
  void args;
  llamadas.push("findMany");
  return [];
});

/** Any access to `tx.usuario` (where the PINs live) fails the test: a huella is never compared with a PIN. */
const tx = new Proxy(
  { $executeRaw: executeRawMock, credencialOperador: { findMany: findManyMock } },
  {
    get(destino, propiedad) {
      if (propiedad in destino) return (destino as Record<string | symbol, unknown>)[propiedad];
      throw new Error(`unexpected access to tx.${String(propiedad)}`);
    },
  },
) as unknown as Prisma.TransactionClient;

const { enrolamiento } = REGISTRO.HUELLA;
if (!enrolamiento) throw new Error("the huella must define its enrolment");

function disponible(codigo: string) {
  return assertCodigoDisponible(enrolamiento!.fuente, tx, TENANT_ID, USUARIO_ID, codigo, { mensaje: enrolamiento!.noDisponible, campo: enrolamiento!.clave });
}

beforeEach(() => {
  llamadas.length = 0;
  executeRawMock.mockClear();
  findManyMock.mockReset().mockImplementation(async () => {
    llamadas.push("findMany");
    return [];
  });
  verifyPasswordMock.mockClear();
});

describe("huella uniqueness", () => {
  it("takes the lock of that method and tenant before reading the other hashes", async () => {
    await disponible("codigo-nuevo-1");

    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]).toContain("pg_advisory_xact_lock(hashtext('fsj.credencial:'");
    expect(llamadas[0]).toContain(`HUELLA,${TENANT_ID}`);
    expect(llamadas[1]).toBe("findMany");
  });

  it("the lock key names the method: another method of the same tenant does not wait for the huella", async () => {
    const otra = fuenteDeCredencial("PIN");
    await otra.hashesDeOtros(tx, TENANT_ID, USUARIO_ID);
    expect(llamadas[0]).toContain(`PIN,${TENANT_ID}`);
  });

  it("reads only this method's credentials of the OTHER usuarios of the tenant", async () => {
    await disponible("codigo-nuevo-1");

    expect(findManyMock).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID, metodo: "HUELLA", usuarioId: { not: USUARIO_ID } }, select: { hash: true } });
  });

  it("accepts a code nobody else holds", async () => {
    findManyMock.mockResolvedValue([{ hash: "hash:otro-codigo-1" }]);
    await expect(disponible("codigo-nuevo-1")).resolves.toBeUndefined();
  });

  it("rejects a code another empleado holds, on the huella field, without saying whose it is", async () => {
    findManyMock.mockResolvedValue([{ hash: "hash:otro-codigo-1" }, { hash: "hash:codigo-repetido" }]);

    const error = await disponible("codigo-repetido").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ message: "Ese código no se puede usar. Probá con otro.", fields: ["huella"] });
    expect((error as Error).message).not.toMatch(/usuario|nombre|email|pertenece/i);
  });

  it("accepts the same text as a PIN, the usuario's own or another's: the PIN is never read (tx.usuario would throw)", async () => {
    // "4829" is a PIN hash in usuario.pin_hash; the huella source only ever sees credencial_operador rows.
    findManyMock.mockResolvedValue([]);
    await expect(disponible("4829")).resolves.toBeUndefined();
  });

  it("two farmacias do not influence each other: the query is scoped to the tenant", async () => {
    await disponible("codigo-nuevo-1");
    const consulta = findManyMock.mock.calls[0]![0] as { where: { tenantId: string } };
    expect(consulta.where.tenantId).toBe(TENANT_ID);
  });
});
