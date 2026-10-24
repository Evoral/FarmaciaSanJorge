/**
 * T3-05 DB tests: Real application path for purchases and adjustments with active contralor digital.
 *
 * Audit finding T3-05 (P3-01):
 * - Blocks enabling digital contralor: with `fecha_activacion_contralor` loaded and a controlled drug,
 *   running the real application path (`registrarPartidaCompra` with vale and `registrarAjusteEnTx`)
 *   must automatically write the corresponding `fsj.asiento_contralor` (INGRESO / AJUSTE).
 * - The deferred constraint trigger INV-L08 must pass without rejection when checked via
 *   `SET CONSTRAINTS ALL IMMEDIATE`.
 * - Negative test: inserting a controlled movement directly without the matching asiento_contralor
 *   is rejected by INV-L08 on `SET CONSTRAINTS ALL IMMEDIATE`.
 * - All operations run within a rolled-back transaction; zero rows persist.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import {
  insertTenant,
  createSistemaUser,
  crearLibrosRubricados,
  insertUnidad,
  insertProveedor,
  createUserWithRole,
  designarDt,
  crearPartidaConIngreso,
  FUTURO,
} from "./fixtures";
import { registrarPartidaCompra } from "@/modules/stock/application/ingresar-partida";
import { registrarAjusteEnTx } from "@/modules/stock/application/registrar-ajuste";
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

describe.skipIf(dbTestSkipReason() !== null)("T3-05: stock purchases and adjustments with active contralor (real app path)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registrarPartidaCompra and registrarAjusteEnTx create asiento_contralor and satisfy INV-L08", async () => {
    let testCompleted = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const c = fixtureClient(tx);
          const tenantId = await insertTenant(c, "t305ctrl");
          const sistema = await createSistemaUser(c, tenantId);
          await crearLibrosRubricados(c, tenantId, sistema);

          const unidadId = await insertUnidad(c, "t305ctrl");

          // Insert a controlled drug (PSICOTROPICO)
          const drogaRes = await c.query(
            `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, es_controlada, tipo_control, clase)
             VALUES ($1, $2, $3, true, 'PSICOTROPICO', 'DROGA')
             RETURNING id, nombre`,
            [tenantId, "Diazepam Test T3-05", unidadId],
          );
          const drogaId = drogaRes.rows[0].id as string;

          const proveedorId = await insertProveedor(c, tenantId);
          const dtId = await createUserWithRole(c, tenantId, "DIRECTOR_TECNICO", sistema, "t305dt");
          await designarDt(c, tenantId, dtId, sistema);

          // Activate digital contralor for this tenant
          await c.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = now() - interval '1 day' WHERE id = $1`, [tenantId]);

          // INV-L15: The drug must have an APERTURA in the libro contralor before any INGRESO/AJUSTE
          await c.query(
            `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
             VALUES ($1, 'APERTURA', $2, 'Diazepam Apertura', 0, $3, $4)`,
            [tenantId, drogaId, unidadId, sistema],
          );

          // Switch session context to fsj_app with the tenant set
          await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

          const session = {
            sesionId: "ses-t305",
            tenantId,
            usuario: { id: sistema, email: "sistema@fsj.test", nombre: "Sistema", apellido: "FSJ" },
            permisos: new Set(["stock.ingresar", "stock.ajustar"]),
          };

          // ------------------------------------------------------------------
          // 1. Camino REAL: registrarPartidaCompra (origen COMPRA con vale)
          // ------------------------------------------------------------------
          const NUM_VALE = "VALE-2026-T305";
          const compraResult = await registrarPartidaCompra(tx, session as never, {
            drogaId,
            proveedorId,
            lote: "LOTE-CTRL-001",
            fechaVencimiento: FUTURO,
            cantidadCompra: "100",
            unidadCompraId: unidadId,
            costo: { porUnidadCompra: "50" },
            numeroValeAdquisicion: NUM_VALE,
          });

          expect(compraResult.id).toBeTruthy();

          // Force deferred constraint triggers: INV-L08 MUST NOT reject
          await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

          // Verify that fsj.asiento_contralor has the matching INGRESO row
          const asientosIngreso = await tx.$queryRawUnsafe<
            { id: string; tipo_movimiento: string; droga_id: string; numero_vale_adquisicion: string; cantidad: string }[]
          >(
            `SELECT id, tipo_movimiento, droga_id, numero_vale_adquisicion, cantidad::text
             FROM fsj.asiento_contralor
             WHERE tenant_id = $1::uuid AND droga_id = $2::uuid AND tipo_movimiento = 'INGRESO'`,
            tenantId,
            drogaId,
          );

          expect(asientosIngreso).toHaveLength(1);
          expect(asientosIngreso[0].tipo_movimiento).toBe("INGRESO");
          expect(asientosIngreso[0].numero_vale_adquisicion).toBe(NUM_VALE);
          expect(Number(asientosIngreso[0].cantidad)).toBe(100);

          // Reset constraints back to DEFERRED so the next operation can insert its movimiento + asiento
          await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");

          // ------------------------------------------------------------------
          // 2. Camino REAL: registrarAjusteEnTx (ROTURA)
          // ------------------------------------------------------------------
          const ajusteResult = await registrarAjusteEnTx(tx, session as never, {
            partidaId: compraResult.id,
            cantidad: dec("5"),
            motivoAjuste: "ROTURA",
            observacion: "Rotura de ampolla en control de calidad",
            autorizadoPorId: dtId,
          });

          expect(ajusteResult.id).toBeTruthy();

          // Force deferred constraints again: INV-L08 MUST NOT reject
          await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

          // Verify that fsj.asiento_contralor has the matching AJUSTE row
          const asientosAjuste = await tx.$queryRawUnsafe<
            { id: string; tipo_movimiento: string; droga_id: string; cantidad: string; movimiento_stock_id: string }[]
          >(
            `SELECT id, tipo_movimiento, droga_id, cantidad::text, movimiento_stock_id
             FROM fsj.asiento_contralor
             WHERE tenant_id = $1::uuid AND droga_id = $2::uuid AND tipo_movimiento = 'AJUSTE'`,
            tenantId,
            drogaId,
          );

          expect(asientosAjuste).toHaveLength(1);
          expect(asientosAjuste[0].tipo_movimiento).toBe("AJUSTE");
          expect(Number(asientosAjuste[0].cantidad)).toBe(5);
          expect(asientosAjuste[0].movimiento_stock_id).toBe(ajusteResult.id);

          testCompleted = true;
          // Unconditional rollback: never commit anything to the real DB
          throw new RollbackSentinel();
        },
        { maxWait: 20_000, timeout: 30_000 },
      );
    } catch (e) {
      if (!(e instanceof RollbackSentinel)) throw e;
    }

    expect(testCompleted, "Test transaction should complete before throwing sentinel").toBe(true);
  });

  it("negative case: inserting a controlled movimiento_stock without matching asiento_contralor fails INV-L08", async () => {
    let caughtError: unknown;

    try {
      await prisma.$transaction(
        async (tx) => {
          const c = fixtureClient(tx);
          const tenantId = await insertTenant(c, "t305neg");
          const sistema = await createSistemaUser(c, tenantId);
          await crearLibrosRubricados(c, tenantId, sistema);

          const unidadId = await insertUnidad(c, "t305neg");
          const drogaRes = await c.query(
            `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, es_controlada, tipo_control, clase)
             VALUES ($1, $2, $3, true, 'PSICOTROPICO', 'DROGA')
             RETURNING id`,
            [tenantId, "Morfina Test Negativo", unidadId],
          );
          const drogaId = drogaRes.rows[0].id as string;
          const proveedorId = await insertProveedor(c, tenantId);
          const dtId = await createUserWithRole(c, tenantId, "DIRECTOR_TECNICO", sistema, "t305dtneg");
          await designarDt(c, tenantId, dtId, sistema);

          // Create a partida with initial stock BEFORE activating contralor
          const partidaId = await crearPartidaConIngreso(c, {
            tenantId,
            drogaId,
            proveedorId,
            registradoPorId: sistema,
            cantidadInicial: 100,
            fechaVencimiento: FUTURO,
          });

          // Activate digital contralor
          await c.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = now() - interval '1 day' WHERE id = $1`, [tenantId]);

          // INV-L15: Drug has APERTURA
          await c.query(
            `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
             VALUES ($1, 'APERTURA', $2, 'Morfina Apertura', 0, $3, $4)`,
            [tenantId, drogaId, unidadId, sistema],
          );

          // Switch session context to fsj_app with the tenant set
          await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

          // Insert a movimiento_stock (AJUSTE) WITHOUT an asiento_contralor
          await c.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, motivo_ajuste, autorizado_por_id)
             VALUES ($1, $2, 'AJUSTE', 5, $3, 'ROTURA', $4)`,
            [tenantId, partidaId, sistema, dtId],
          );

          // Trigger evaluation of deferred constraints: must reject with INV-L08
          await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

          throw new RollbackSentinel();
        },
        { maxWait: 20_000, timeout: 30_000 },
      );
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    expect((caughtError as Error).message).toMatch(/INV-L08/);
  });
});
