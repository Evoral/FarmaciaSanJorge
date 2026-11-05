/**
 * DB tests for active tenant listing (security audit P1-02, migration 0119).
 *
 * Context:
 * Migration 0119 placed `fsj.tenant` under Row Level Security (RLS) to enforce
 * strict tenant isolation. Under RLS, `fsj_app` can no longer SELECT from `fsj.tenant`
 * when `app.tenant_id` is unset.
 *
 * The platform daily jobs (archivo plazos and retiros vencidos) run in
 * `withPlatformTransaction` (without `app.tenant_id`) and iterate over all active
 * pharmacies using the SECURITY DEFINER function `fsj.listar_tenants_activos()`.
 *
 * This function is called via `listActiveTenantIds` in:
 * - modules/archivo/infrastructure/archivo-repository.ts
 * - modules/entregas/infrastructure/retiro-vencido-repository.ts
 *
 * Why this DB test is necessary:
 * The unit tests for both jobs mock these repository functions in memory, which means
 * no unit test verifies that the real database function exists, that `fsj_app` has EXECUTE
 * permissions on it, and that the returned result matches the expected `{ id: string }` shape
 * filtered by `fecha_baja IS NULL`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { listActiveTenantIds as listActiveArchivo } from "@/modules/archivo/infrastructure/archivo-repository";
import { listActiveTenantIds as listActiveEntregas } from "@/modules/entregas/infrastructure/retiro-vencido-repository";

class RollbackSentinel extends Error {}

describe.skipIf(dbTestSkipReason() !== null)("0119_tenant_rls: listActiveTenantIds real queries", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("lists active tenants and excludes inactive ones under fsj_app with no app.tenant_id", async () => {
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          // As migration owner: insert one active tenant and one with fecha_baja = now()
          const cuitActivo = `20-${Date.now()}-act-${Math.random().toString(36).slice(2, 6)}`;
          const cuitBaja = `20-${Date.now()}-baj-${Math.random().toString(36).slice(2, 6)}`;

          const resActivo = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Tenant Activo', $1) RETURNING id`,
            cuitActivo,
          );
          const activoId = resActivo[0].id;

          const resBaja = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO fsj.tenant (razon_social, cuit, fecha_baja) VALUES ('Tenant Baja', $1, now()) RETURNING id`,
            cuitBaja,
          );
          const bajaId = resBaja[0].id;

          // Switch to runtime role fsj_app without setting app.tenant_id (like withPlatformTransaction)
          await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");

          const archivoTenantIds = await listActiveArchivo(tx);
          const entregasTenantIds = await listActiveEntregas(tx);

          expect(Array.isArray(archivoTenantIds)).toBe(true);
          expect(Array.isArray(entregasTenantIds)).toBe(true);
          expect(archivoTenantIds.every((id) => typeof id === "string")).toBe(true);
          expect(entregasTenantIds.every((id) => typeof id === "string")).toBe(true);

          expect(archivoTenantIds).toContain(activoId);
          expect(archivoTenantIds).not.toContain(bajaId);

          expect(entregasTenantIds).toContain(activoId);
          expect(entregasTenantIds).not.toContain(bajaId);

          expect(archivoTenantIds).toEqual(entregasTenantIds);

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
