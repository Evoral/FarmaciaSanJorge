/**
 * DB tests for trasladarBorradoresDeFicha (migration 0113 addendum, modules/elaboracion/infrastructure/ficha-repository.ts):
 * Carries the toma workspace drafts of an item's previous ficha version over to a new one:
 * - Excipiente typed per unidad keeps quantity and por_unidad = true when the new version is still dosificable (porUnidadValido = true).
 * - Excipiente typed per unidad clears quantity to NULL and sets por_unidad = false when porUnidadValido = false (e.g. forma edited to CREMA).
 * - Excipiente typed as c.s.p. (por_unidad = false) carries quantity and por_unidad = false intact regardless of porUnidadValido.
 * - Insumos borradores and pesada borradores are carried over to matching líneas.
 * - Existing drafts on the new ficha version are preserved (ON CONFLICT DO NOTHING).
 *
 * Runs inside rolled-back interactive transactions (same pattern as tests/db/busqueda-persona.test.ts); zero rows persist.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import {
  createSistemaUser,
  insertMedico,
  insertPaciente,
  insertProveedor,
  insertReceta,
  insertItemReceta,
  insertFicha,
  insertLinea,
  crearPartidaConIngreso,
  insertTenant,
} from "./fixtures";
import { trasladarBorradoresDeFicha } from "@/modules/elaboracion/infrastructure/ficha-repository";
import { upsertExcipienteBorrador } from "@/modules/preparaciones/infrastructure/preparacion-repository";

class RollbackSentinel extends Error {}

function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

let migration0113Applied = false;

interface SeedContext {
  c: Client;
  tenantId: string;
  sistema: string;
  unidadG: string;
  unidadMg: string;
  excipienteDrogaId: string;
  activoDrogaId: string;
  recetaId: string;
  partidaActivoId: string;
}

async function setupBase(tx: Prisma.TransactionClient): Promise<SeedContext> {
  const c = fixtureClient(tx);
  const tenantId = await insertTenant(c, "trasbor");
  const sistema = await createSistemaUser(c, tenantId);

  const codG = `U_G_${randomUUID().slice(0, 8)}`;
  const resG = await c.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, 'Gramo Test', 'g', 'MASA', 1, false) RETURNING id`,
    [codG],
  );
  const unidadG = resG.rows[0].id as string;

  const codMg = `U_MG_${randomUUID().slice(0, 8)}`;
  const resMg = await c.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, 'Miligramo Test', 'mg', 'MASA', 0.001, false) RETURNING id`,
    [codMg],
  );
  const unidadMg = resMg.rows[0].id as string;

  const resExcipiente = await c.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase)
     VALUES ($1, 'Ludipress', $2, 'EXCIPIENTE')
     RETURNING id`,
    [tenantId, unidadG],
  );
  const excipienteDrogaId = resExcipiente.rows[0].id as string;

  const resActivo = await c.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase)
     VALUES ($1, 'Minoxidil', $2, 'DROGA')
     RETURNING id`,
    [tenantId, unidadMg],
  );
  const activoDrogaId = resActivo.rows[0].id as string;

  const proveedorId = await insertProveedor(c, tenantId);
  const partidaActivoId = await crearPartidaConIngreso(c, {
    tenantId,
    drogaId: activoDrogaId,
    proveedorId,
    registradoPorId: sistema,
    cantidadInicial: 500,
  });

  const pacienteId = await insertPaciente(c, tenantId);
  const medicoId = await insertMedico(c, tenantId);

  await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

  const recetaId = await insertReceta(c, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

  return {
    c,
    tenantId,
    sistema,
    unidadG,
    unidadMg,
    excipienteDrogaId,
    activoDrogaId,
    recetaId,
    partidaActivoId,
  };
}

describe.skipIf(dbTestSkipReason() !== null)("DB tests: trasladarBorradoresDeFicha (migration 0113 addendum)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (dbTestSkipReason() !== null) return;
    try {
      const { directUrl } = requireDbTestEnv();
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
      const res = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'fsj' AND table_name = 'preparacion' AND column_name = 'excipiente_cantidad_por_unidad'`,
      );
      migration0113Applied = res.length > 0;
    } catch {
      migration0113Applied = false;
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("carries excipiente borrador per unidad intact when porUnidadValido is true", async (ctx) => {
    if (!migration0113Applied) {
      ctx.skip("migration 0113 not applied");
      return;
    }

    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const s = await setupBase(tx);

          const itemId = await insertItemReceta(s.c, {
            tenantId: s.tenantId,
            recetaId: s.recetaId,
            formaFarmaceutica: "CAPSULA",
            cantidadUnidades: 30,
            fraccionDosisPorUnidad: 0.5,
          });
          const fichaV1Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 1, generadaPorId: s.sistema });

          // Save draft per unidad on v1
          await upsertExcipienteBorrador(tx, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaV1Id,
            drogaId: s.excipienteDrogaId,
            cantidad: "0.8",
            porUnidad: true,
            actualizadoPorId: s.sistema,
          });

          // Create ficha v2 for the same item
          const fichaV2Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 2, generadaPorId: s.sistema });

          // Carry over with porUnidadValido = true
          await trasladarBorradoresDeFicha(tx, {
            tenantId: s.tenantId,
            fichaNuevaId: fichaV2Id,
            porUnidadValido: true,
          });

          const borradorV2 = await tx.excipienteBorrador.findUnique({
            where: { tenantId_fichaTecnicaId: { tenantId: s.tenantId, fichaTecnicaId: fichaV2Id } },
          });
          expect(borradorV2).not.toBeNull();
          expect(borradorV2?.drogaId).toBe(s.excipienteDrogaId);
          expect(borradorV2?.cantidad?.toString()).toBe("0.8");
          expect(borradorV2?.porUnidad).toBe(true);

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

  it("clears cantidad to NULL and sets porUnidad = false when porUnidadValido is false", async (ctx) => {
    if (!migration0113Applied) {
      ctx.skip("migration 0113 not applied");
      return;
    }

    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const s = await setupBase(tx);

          const itemId = await insertItemReceta(s.c, {
            tenantId: s.tenantId,
            recetaId: s.recetaId,
            formaFarmaceutica: "CAPSULA",
            cantidadUnidades: 30,
            fraccionDosisPorUnidad: 0.5,
          });
          const fichaV1Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 1, generadaPorId: s.sistema });

          // Save draft per unidad on v1
          await upsertExcipienteBorrador(tx, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaV1Id,
            drogaId: s.excipienteDrogaId,
            cantidad: "0.8",
            porUnidad: true,
            actualizadoPorId: s.sistema,
          });

          // Create ficha v2 (e.g. receta was edited to CREMA, so porUnidadValido is false)
          const fichaV2Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 2, generadaPorId: s.sistema });

          // Carry over with porUnidadValido = false
          await trasladarBorradoresDeFicha(tx, {
            tenantId: s.tenantId,
            fichaNuevaId: fichaV2Id,
            porUnidadValido: false,
          });

          const borradorV2 = await tx.excipienteBorrador.findUnique({
            where: { tenantId_fichaTecnicaId: { tenantId: s.tenantId, fichaTecnicaId: fichaV2Id } },
          });
          expect(borradorV2).not.toBeNull();
          expect(borradorV2?.drogaId).toBe(s.excipienteDrogaId);
          // Quantity cleared so per-unidad amount is not mistakenly read as total c.s.p.
          expect(borradorV2?.cantidad).toBeNull();
          expect(borradorV2?.porUnidad).toBe(false);

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

  it("carries excipiente borrador c.s.p. intact even when porUnidadValido is false", async (ctx) => {
    if (!migration0113Applied) {
      ctx.skip("migration 0113 not applied");
      return;
    }

    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const s = await setupBase(tx);

          const itemId = await insertItemReceta(s.c, {
            tenantId: s.tenantId,
            recetaId: s.recetaId,
            formaFarmaceutica: "CREMA",
            cantidadUnidades: 1,
            fraccionDosisPorUnidad: 1,
            cantidadTotal: 100,
            unidadTotalId: s.unidadG,
          });
          const fichaV1Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 1, generadaPorId: s.sistema });

          // Save draft c.s.p. (por_unidad = false) on v1
          await upsertExcipienteBorrador(tx, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaV1Id,
            drogaId: s.excipienteDrogaId,
            cantidad: "15",
            porUnidad: false,
            actualizadoPorId: s.sistema,
          });

          const fichaV2Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 2, generadaPorId: s.sistema });

          await trasladarBorradoresDeFicha(tx, {
            tenantId: s.tenantId,
            fichaNuevaId: fichaV2Id,
            porUnidadValido: false,
          });

          const borradorV2 = await tx.excipienteBorrador.findUnique({
            where: { tenantId_fichaTecnicaId: { tenantId: s.tenantId, fichaTecnicaId: fichaV2Id } },
          });
          expect(borradorV2).not.toBeNull();
          expect(borradorV2?.drogaId).toBe(s.excipienteDrogaId);
          expect(borradorV2?.cantidad?.toString()).toBe("15");
          expect(borradorV2?.porUnidad).toBe(false);

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

  it("carries insumos borradores and pesada borradores over to matching líneas", async (ctx) => {
    if (!migration0113Applied) {
      ctx.skip("migration 0113 not applied");
      return;
    }

    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const s = await setupBase(tx);

          const itemId = await insertItemReceta(s.c, {
            tenantId: s.tenantId,
            recetaId: s.recetaId,
            formaFarmaceutica: "CAPSULA",
            cantidadUnidades: 30,
            fraccionDosisPorUnidad: 0.5,
          });

          // Ficha v1 with a línea de pesaje
          const fichaV1Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 1, generadaPorId: s.sistema });
          const lineaV1Id = await insertLinea(s.c, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaV1Id,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            cantidadAPesar: 0.15,
          });

          // Drafts on v1: insumo_borrador and pesada_borrador
          await s.c.query(
            `INSERT INTO fsj.insumo_borrador (tenant_id, ficha_tecnica_id, tipo, orden, droga_id, cantidad, actualizado_por_id)
             VALUES ($1, $2, 'ADICIONAL', 0, $3, 0.5, $4)`,
            [s.tenantId, fichaV1Id, s.excipienteDrogaId, s.sistema],
          );
          await s.c.query(
            `INSERT INTO fsj.pesada_borrador (tenant_id, linea_pesaje_id, partida_ids, cantidad_real, motivo_apertura_adicional, actualizado_por_id)
             VALUES ($1, $2, ARRAY[$3]::uuid[], 0.1502, 'Frasco nuevo abierto', $4)`,
            [s.tenantId, lineaV1Id, s.partidaActivoId, s.sistema],
          );

          // Ficha v2 with matching línea (same droga, same cantidad_a_pesar, same unit)
          const fichaV2Id = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, version: 2, generadaPorId: s.sistema });
          const lineaV2Id = await insertLinea(s.c, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaV2Id,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            cantidadAPesar: 0.15,
          });

          await trasladarBorradoresDeFicha(tx, {
            tenantId: s.tenantId,
            fichaNuevaId: fichaV2Id,
            porUnidadValido: true,
          });

          // Insumo borrador carried to v2
          const insumosV2 = await s.c.query(
            `SELECT tipo, droga_id, cantidad FROM fsj.insumo_borrador WHERE tenant_id = $1 AND ficha_tecnica_id = $2`,
            [s.tenantId, fichaV2Id],
          );
          expect(insumosV2.rows).toHaveLength(1);
          expect(insumosV2.rows[0].tipo).toBe("ADICIONAL");
          expect(insumosV2.rows[0].droga_id).toBe(s.excipienteDrogaId);
          expect(Number(insumosV2.rows[0].cantidad)).toBe(0.5);

          // Pesada borrador carried to lineaV2
          const pesadaV2 = await s.c.query(
            `SELECT linea_pesaje_id, partida_ids, cantidad_real, motivo_apertura_adicional
             FROM fsj.pesada_borrador WHERE tenant_id = $1 AND linea_pesaje_id = $2`,
            [s.tenantId, lineaV2Id],
          );
          expect(pesadaV2.rows).toHaveLength(1);
          expect(pesadaV2.rows[0].linea_pesaje_id).toBe(lineaV2Id);
          expect(pesadaV2.rows[0].partida_ids).toEqual([s.partidaActivoId]);
          expect(Number(pesadaV2.rows[0].cantidad_real)).toBe(0.1502);
          expect(pesadaV2.rows[0].motivo_apertura_adicional).toBe("Frasco nuevo abierto");

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
