/**
 * Regression guard for the `relationJoins` preview feature in
 * prisma/schema.prisma.
 *
 * THE PROBLEM IT GUARDS AGAINST: without `relationJoins`, Prisma 7's query
 * interpreter loads the sibling relations of a `select`/`include` (e.g.
 * kardex's `partida`, `registradoPor`, `autorizadoPor`) as separate child
 * queries resolved with `Promise.all` (the `"join"` node in
 * @prisma/client/runtime/client.js). Every use case in this app runs inside
 * an interactive transaction (`shared/db/transaction.ts#withTenantTransaction`),
 * which pins ONE `pg.Client` -- so those child queries were issued
 * concurrently on the same client. pg 8.x silently queues them (and logs
 * "Calling client.query() when the client is already executing a query is
 * deprecated"); pg@9 removes that queue, at which point every such query
 * breaks. With `relationJoins`, Postgres relations load through a single
 * SQL statement (LATERAL joins + JSON aggregation), so the transaction
 * client never has more than one query in flight.
 *
 * HOW: `pg.Client.prototype.query` is wrapped for the duration of each test
 * to count in-flight queries PER CLIENT, and the test asserts the peak is
 * exactly 1. The wrapper patches the prototype shared by every `pg.Client`
 * in the process (including the ones `@prisma/adapter-pg`'s pool creates),
 * and is always restored in `finally`.
 *
 * WHY A TEST-LOCAL PrismaClient INSTEAD OF `withTenantTransaction`: the
 * runtime singleton connects as `fsj_app` (DATABASE_URL), which can't
 * INSERT into fsj.tenant -- and an EMPTY result proves nothing (with no
 * parent rows Prisma never issues the child queries at all). So this test
 * builds its own PrismaClient over DIRECT_URL (the migration owner, same
 * connection the rest of tests/db uses), seeds real rows INSIDE a Prisma
 * interactive transaction, then drops to `fsj_app` + `app.tenant_id` (the
 * exact state `withTenantTransaction` produces) and runs the REAL
 * repository query. The transaction mechanism under test -- one Prisma
 * interactive transaction pinned to one `pg.Client` via `@prisma/adapter-pg`
 * -- is identical to production's.
 *
 * SAFETY: the transaction callback always ends by throwing a sentinel
 * error, so Prisma ROLLBACKs it and nothing seeded here persists (same
 * "never commit" rule as tests/db/helpers.ts#inRollbackTx).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { kardexMovimientos } from "@/modules/stock/infrastructure/partida-repository";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import {
  crearPartidaConIngreso,
  createSistemaUser,
  insertDroga,
  insertProveedor,
  insertTenant,
  insertUnidad,
} from "./fixtures";

class RollbackSentinel extends Error {}

/**
 * Minimal `pg.Client`-shaped facade over a Prisma transaction, so the
 * existing raw-SQL fixtures (which only ever call `.query(sql, params)` and
 * read `.rows`) can seed rows INSIDE the Prisma transaction -- a separate
 * pg connection could never see those uncommitted rows.
 */
function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

/**
 * Wraps `pg.Client.prototype.query` and records, per client, the highest
 * number of queries in flight at once. Only promise-returning calls are
 * tracked (the form `@prisma/adapter-pg` uses); callback/submittable calls
 * pass through untouched.
 */
function trackQueryConcurrency(): { peak: () => number; restore: () => void } {
  const original = Client.prototype.query;
  const inFlight = new WeakMap<object, number>();
  let peak = 0;

  Client.prototype.query = function patchedQuery(this: Client, ...args: unknown[]) {
    const result = (original as (...a: unknown[]) => unknown).apply(this, args);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const current = (inFlight.get(this) ?? 0) + 1;
      inFlight.set(this, current);
      peak = Math.max(peak, current);
      const settle = () => inFlight.set(this, (inFlight.get(this) ?? 1) - 1);
      (result as Promise<unknown>).then(settle, settle);
    }
    return result;
  } as typeof Client.prototype.query;

  return {
    peak: () => peak,
    restore: () => {
      Client.prototype.query = original;
    },
  };
}

interface Seed {
  tenantId: string;
  partidaIds: string[];
}

/** Two partidas, each with its mandatory INGRESO_COMPRA movimiento. */
async function seedKardex(tx: Prisma.TransactionClient): Promise<Seed> {
  const c = fixtureClient(tx);
  const tenantId = await insertTenant(c, "reljoin");
  const sistema = await createSistemaUser(c, tenantId);
  const unidadId = await insertUnidad(c, "reljoin");
  const drogaId = await insertDroga(c, tenantId, unidadId);
  const proveedorId = await insertProveedor(c, tenantId);
  const partidaIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    partidaIds.push(await crearPartidaConIngreso(c, { tenantId, drogaId, proveedorId, registradoPorId: sistema }));
  }
  return { tenantId, partidaIds };
}

/** Same session state `withTenantTransaction` gives production code. */
async function actAsTenantApp(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

/**
 * Seeds, switches to the runtime role, runs `query` while tracking pg
 * concurrency, then ALWAYS rolls back. Returns `query`'s result and the
 * peak number of in-flight queries seen on any single client.
 */
async function runInRolledBackTx<T>(
  prisma: PrismaClient,
  query: (tx: Prisma.TransactionClient, seed: Seed) => Promise<T>,
): Promise<{ result: T; peak: number }> {
  let captured: { result: T; peak: number } | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        const seed = await seedKardex(tx);
        await actAsTenantApp(tx, seed.tenantId);
        const tracker = trackQueryConcurrency();
        try {
          const result = await query(tx, seed);
          captured = { result, peak: tracker.peak() };
        } finally {
          tracker.restore();
        }
        throw new RollbackSentinel();
      },
      // Seeding runs ~20 round trips against the remote database; Prisma's
      // 5s interactive-transaction default is too tight for that.
      { maxWait: 20_000, timeout: 25_000 },
    );
  } catch (e) {
    if (!(e instanceof RollbackSentinel)) throw e;
  }
  if (!captured) throw new Error("query did not complete");
  return captured;
}

describe.skipIf(dbTestSkipReason() !== null)("Prisma relation loading inside an interactive transaction (relationJoins)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("kardexMovimientos (to-one siblings partida{droga}, registradoPor, autorizadoPor) never has >1 query in flight on the tx client", async () => {
    const { result, peak } = await runInRolledBackTx(prisma, (tx, seed) =>
      kardexMovimientos(tx, { tenantId: seed.tenantId, page: 1, pageSize: 50 }),
    );

    // Non-empty, with relations actually loaded -- otherwise Prisma would
    // never have issued the child queries and peak==1 would prove nothing.
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.drogaNombre).toMatch(/^Droga-/);
      expect(item.lote).toMatch(/^LOTE-/);
      expect(item.registradoPorNombre).toBe("Sistema");
    }
    expect(peak).toBe(1);
  });

  it("a to-many + to-one sibling shape (partida{droga, proveedor, movimientos}) never has >1 query in flight on the tx client", async () => {
    const { result, peak } = await runInRolledBackTx(prisma, (tx, seed) =>
      tx.partida.findMany({
        where: { tenantId: seed.tenantId },
        select: {
          id: true,
          droga: { select: { nombre: true } },
          proveedor: { select: { razonSocial: true } },
          movimientos: { select: { tipo: true, registradoPor: { select: { nombre: true } } } },
        },
      }),
    );

    expect(result).toHaveLength(2);
    for (const partida of result) {
      expect(partida.droga.nombre).toMatch(/^Droga-/);
      expect(partida.proveedor.razonSocial).toBe("Prov");
      expect(partida.movimientos).toEqual([{ tipo: "INGRESO_COMPRA", registradoPor: { nombre: "Sistema" } }]);
    }
    expect(peak).toBe(1);
  });
});
