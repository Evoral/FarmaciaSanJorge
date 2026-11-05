/**
 * DB tests for `getStockDeDroga` (commit e8674fd, modules/stock/infrastructure/partida-repository.ts).
 *
 * Verifies that:
 * - For a droga with no partidas, getStockDeDroga returns disponible "0", activo "0", and its unidad_base symbol.
 * - For a non-existent droga id, getStockDeDroga returns null.
 *
 * Runs inside a rolled-back Prisma interactive transaction (inRollbackTx safety net).
 * Zero rows persist.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { insertTenant, insertDroga } from "./fixtures";
import { getStockDeDroga } from "@/modules/stock/infrastructure/partida-repository";
import { dec } from "@/shared/decimal";

class RollbackSentinel extends Error {}

function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

describe.skipIf(dbTestSkipReason() !== null)("DB tests: getStockDeDroga (partida-repository)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("returns disponible and activo '0' for a droga with no partidas, its unidad_base symbol, and null for non-existent droga", async () => {
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const c = fixtureClient(tx);
          const tenantId = await insertTenant(c, "stock-exacto");

          // Pick an existing base unit (GRAMO -> "g")
          const resUnidad = await c.query("SELECT id, simbolo FROM fsj.unidad_medida WHERE codigo = 'GRAMO' LIMIT 1");
          const { id: unidadId, simbolo } = resUnidad.rows[0] as { id: string; simbolo: string };

          // Insert a droga with no partidas
          const drogaId = await insertDroga(c, tenantId, unidadId);

          // Switch session context to fsj_app with the tenant set (RLS simulation)
          await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

          // 1. Droga with no partidas: disponible "0", activo "0", and unit symbol
          const stock = await getStockDeDroga(tx, tenantId, drogaId);
          // stock_activo (0111) is a weighted sum, so its numeric scale is not 0 ("0.000..."): compare it as a number.
          expect(stock).toMatchObject({ disponible: "0", unidadSimbolo: simbolo });
          expect(dec(stock!.activo).isZero()).toBe(true);

          // 2. Non-existent droga ID: null
          const nonExistentStock = await getStockDeDroga(tx, tenantId, randomUUID());
          expect(nonExistentStock).toBeNull();

          completed = true;
          throw new RollbackSentinel();
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (!(error instanceof RollbackSentinel)) throw error;
    }

    expect(completed).toBe(true);
  });
});
