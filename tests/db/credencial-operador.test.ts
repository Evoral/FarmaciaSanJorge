/**
 * DB tests for prisma/migrations/*_0137_credencial_operador (openspec/changes/metodos-verificacion-operador).
 *
 * `fsj.credencial_operador (tenant_id, usuario_id, metodo, hash, ...)` holds the argon2id hash of an empleado's secret
 * code for an OPTIONAL verification method (the huella): tenant-scoped (RLS ENABLE + FORCE), one row per
 * (usuario, method), a composite FK to the usuario of its own tenant, and fsj_app may only replace the hash (no other
 * column), insert and delete. See tests/db/helpers.ts for the rollback safety model.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { upsertCredencialOperador } from "@/modules/auth/infrastructure/credencial-operador-repository";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { asOwner, inRollbackTx, withTenant, expectDbRejection } from "./helpers";
import { createSistemaUser, createUserWithRole, insertTenant } from "./fixtures";

class RollbackSentinel extends Error {}

/** Lets the pg-based fixtures run on a Prisma transaction (same pattern as tests/db/excipiente-por-unidad.test.ts). */
function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

async function tenantConUsuario(tx: Parameters<typeof insertTenant>[0], suffix: string): Promise<{ tenantId: string; usuarioId: string }> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const usuarioId = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, suffix);
  return { tenantId, usuarioId };
}

describe.skipIf(dbTestSkipReason() !== null)("0137_credencial_operador (fsj schema)", () => {
  it("has RLS enabled AND forced", async () => {
    await asOwner(async (client) => {
      const { rows } = await client.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'fsj.credencial_operador'::regclass`);
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });

  it("isolates rows by tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await tenantConUsuario(tx, "co-a");
        const b = await tenantConUsuario(tx, "co-b");
        await tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h1'), ($3, $4, 'HUELLA', 'h2')`, [a.tenantId, a.usuarioId, b.tenantId, b.usuarioId]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, a.tenantId, async (c) => {
          const { rows } = await c.query(`SELECT tenant_id, usuario_id FROM fsj.credencial_operador`);
          expect(rows).toEqual([{ tenant_id: a.tenantId, usuario_id: a.usuarioId }]);
        });
      }),
    );
  });

  it("fsj_app cannot insert a row for another tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await tenantConUsuario(tx, "co-c");
        const b = await tenantConUsuario(tx, "co-d");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, a.tenantId, async (c) => {
          await expectDbRejection(c, () => c.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h')`, [b.tenantId, b.usuarioId]), "42501");
        });
      }),
    );
  });

  it("only a usuario of the same tenant can own a credential (composite FK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await tenantConUsuario(tx, "co-e");
        const b = await tenantConUsuario(tx, "co-f");
        await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h')`, [a.tenantId, b.usuarioId]), "23503");
      }),
    );
  });

  it("fsj_app can insert, replace the hash and delete, but not touch any other column", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, usuarioId } = await tenantConUsuario(tx, "co-g");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          await c.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h1')`, [tenantId, usuarioId]);
          const reemplazo = await c.query(`UPDATE fsj.credencial_operador SET hash = 'h2', actualizado_en = now() WHERE tenant_id = $1 AND usuario_id = $2`, [tenantId, usuarioId]);
          expect(reemplazo.rowCount).toBe(1);
          await expectDbRejection(c, () => c.query(`UPDATE fsj.credencial_operador SET metodo = 'ROSTRO' WHERE tenant_id = $1`, [tenantId]), "42501");
          await expectDbRejection(c, () => c.query(`UPDATE fsj.credencial_operador SET usuario_id = usuario_id WHERE tenant_id = $1`, [tenantId]), "42501");
          await expectDbRejection(c, () => c.query(`UPDATE fsj.credencial_operador SET creado_en = now() WHERE tenant_id = $1`, [tenantId]), "42501");
          const borradas = await c.query(`DELETE FROM fsj.credencial_operador WHERE tenant_id = $1`, [tenantId]);
          expect(borradas.rowCount).toBe(1);
        });
      }),
    );
  });

  it("the PIN can never be a row, and the method must look like a registry code", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, usuarioId } = await tenantConUsuario(tx, "co-h");
        for (const metodo of ["PIN", "huella", "H", "CON ESPACIO"]) {
          await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, $3, 'h')`, [tenantId, usuarioId, metodo]), "23514");
        }
      }),
    );
  });

  it("a usuario has at most one credential per method", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, usuarioId } = await tenantConUsuario(tx, "co-i");
        await tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h1')`, [tenantId, usuarioId]);
        await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h2')`, [tenantId, usuarioId]), "23505");
        // Another method is another row.
        await tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'ROSTRO', 'h3')`, [tenantId, usuarioId]);
      }),
    );
  });

  it("indexes the composite FK to usuario (the PK leads with tenant_id, usuario_id)", async () => {
    await asOwner(async (client) => {
      const { rows } = await client.query(
        `SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i WHERE i.indrelid = 'fsj.credencial_operador'::regclass AND i.indisprimary`,
      );
      expect(rows[0]!.def).toContain("(tenant_id, usuario_id, metodo)");
    });
  });

  it("fsj_app has SELECT, INSERT and DELETE, and UPDATE only on hash and actualizado_en", async () => {
    await asOwner(async (client) => {
      const tabla = await client.query(
        `SELECT has_table_privilege('fsj_app', 'fsj.credencial_operador', 'SELECT') AS sel,
                has_table_privilege('fsj_app', 'fsj.credencial_operador', 'INSERT') AS ins,
                has_table_privilege('fsj_app', 'fsj.credencial_operador', 'DELETE') AS del,
                has_table_privilege('fsj_app', 'fsj.credencial_operador', 'UPDATE') AS upd`,
      );
      expect(tabla.rows[0]).toEqual({ sel: true, ins: true, del: true, upd: false });

      const { rows } = await client.query(
        `SELECT a.attname AS columna, has_column_privilege('fsj_app', 'fsj.credencial_operador', a.attname, 'UPDATE') AS puede
           FROM pg_attribute a
          WHERE a.attrelid = 'fsj.credencial_operador'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attname`,
      );
      const actualizables = rows.filter((r) => r.puede).map((r) => r.columna as string);
      expect(actualizables).toEqual(["actualizado_en", "hash"]);
    });
  });
});

describe.skipIf(dbTestSkipReason() !== null)("0137_credencial_operador: the Prisma repository under fsj_app", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (dbTestSkipReason() !== null) return;
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("upsertCredencialOperador inserts then updates the hash with only the grants fsj_app has", async () => {
    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const { tenantId, usuarioId } = await tenantConUsuario(fixtureClient(tx), "co-prisma");
          await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

          const primera = await upsertCredencialOperador(tx, tenantId, usuarioId, "HUELLA", "hash-1", new Date("2026-11-01T10:00:00Z"));
          expect(primera).toEqual({ existia: false });

          const segunda = await upsertCredencialOperador(tx, tenantId, usuarioId, "HUELLA", "hash-2", new Date("2026-11-02T10:00:00Z"));
          expect(segunda).toEqual({ existia: true });

          const filas = await tx.credencialOperador.findMany({ where: { tenantId, usuarioId }, select: { hash: true, creadoEn: true, actualizadoEn: true } });
          expect(filas).toHaveLength(1);
          expect(filas[0]!.hash).toBe("hash-2");
          // The replace never touches creado_en (fsj_app has no UPDATE on it).
          expect(filas[0]!.creadoEn.toISOString()).toBe("2026-11-01T10:00:00.000Z");
          expect(filas[0]!.actualizadoEn.toISOString()).toBe("2026-11-02T10:00:00.000Z");

          completed = true;
          throw new RollbackSentinel();
        },
        { maxWait: 20_000, timeout: 25_000 },
      );
    } catch (e) {
      if (!(e instanceof RollbackSentinel)) throw e;
    }
    expect(completed).toBe(true);
  });
});
