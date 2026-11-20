/**
 * DB tests for `getItemsParaResumenPago` (modules/recetas/infrastructure/receta-repository.ts).
 *
 * Verifies that:
 * 1. Reads each item of recetaId with its latest cotización in the same order as getReceta.
 * 2. An item with a cotización calculated before migration 0107 (costo_insumos_con_iva IS NULL)
 *    falls back to costo_insumos for costoConIva.
 * 3. An item with a newer cotización uses costo_insumos_con_iva.
 * 4. An item without cotización returns ultimaCotizacion: null.
 *
 * Runs inside a rolled-back Prisma interactive transaction (zero rows persist).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import {
  insertTenant,
  createSistemaUser,
  insertPaciente,
  insertMedico,
  insertReceta,
  insertItemReceta,
} from "./fixtures";
import { getItemsParaResumenPago } from "@/modules/recetas/infrastructure/receta-repository";

class RollbackSentinel extends Error {}

function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

async function insertReglaPrecioTest(tx: Client, tenantId: string, creadoPorId: string): Promise<string> {
  const res = await tx.query(
    `INSERT INTO fsj.regla_precio (tenant_id, precio_minimo, creado_por_id)
     VALUES ($1, '0', $2)
     RETURNING id`,
    [tenantId, creadoPorId],
  );
  return res.rows[0].id as string;
}

async function insertCotizacionTest(
  tx: Client,
  input: {
    tenantId: string;
    itemRecetaId: string;
    reglaPrecioId: string;
    calculadaPorId: string;
    costoInsumos: string;
    costoInsumosConIva?: string | null;
    precioFinal: string;
  },
): Promise<string> {
  const res = await tx.query(
    `INSERT INTO fsj.cotizacion (tenant_id, item_receta_id, costo_insumos, costo_insumos_con_iva, margen_aplicado, precio_final, regla_precio_id, detalle, calculada_por_id)
     VALUES ($1, $2, $3, $4, '50', $5, $6, '{"lineas":[]}', $7)
     RETURNING id`,
    [
      input.tenantId,
      input.itemRecetaId,
      input.costoInsumos,
      input.costoInsumosConIva ?? null,
      input.precioFinal,
      input.reglaPrecioId,
      input.calculadaPorId,
    ],
  );
  return res.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("DB tests: getItemsParaResumenPago (modules/recetas/infrastructure/receta-repository)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("reads latest cotizaciones, falls back to costoInsumos if costoInsumosConIva is null, and preserves item order", async () => {
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const c = fixtureClient(tx);
          const tenantId = await insertTenant(c, "res-pago");
          const sistema = await createSistemaUser(c, tenantId);
          const pacienteId = await insertPaciente(c, tenantId);
          const medicoId = await insertMedico(c, tenantId);

          const reglaId = await insertReglaPrecioTest(c, tenantId, sistema);

          const recetaId = await insertReceta(c, {
            tenantId,
            pacienteId,
            medicoId,
            registradaPorId: sistema,
          });

          // Insert 3 items in order
          const item1Id = await insertItemReceta(c, { tenantId, recetaId, formaFarmaceutica: "CREMA" });
          const item2Id = await insertItemReceta(c, { tenantId, recetaId, formaFarmaceutica: "CAPSULA" });
          const item3Id = await insertItemReceta(c, { tenantId, recetaId, formaFarmaceutica: "PAPEL" });

          // Item 1: pre-0107 cotización without IVA (costo_insumos_con_iva IS NULL)
          await insertCotizacionTest(c, {
            tenantId,
            itemRecetaId: item1Id,
            reglaPrecioId: reglaId,
            calculadaPorId: sistema,
            costoInsumos: "100.00",
            costoInsumosConIva: null,
            precioFinal: "150.00",
          });

          // Item 2: post-0107 cotización with IVA
          await insertCotizacionTest(c, {
            tenantId,
            itemRecetaId: item2Id,
            reglaPrecioId: reglaId,
            calculadaPorId: sistema,
            costoInsumos: "200.00",
            costoInsumosConIva: "242.00",
            precioFinal: "363.00",
          });

          // Item 3: no cotización inserted

          // Execute getItemsParaResumenPago
          const items = await getItemsParaResumenPago(tx, tenantId, recetaId);

          expect(items).not.toBeNull();
          expect(items).toHaveLength(3);

          // Ordering matches receta items
          expect(items![0]!.id).toBe(item1Id);
          expect(items![1]!.id).toBe(item2Id);
          expect(items![2]!.id).toBe(item3Id);

          // Item 1: falls back to costoInsumos
          expect(items![0]!.ultimaCotizacion).toEqual({
            costoConIva: "100",
            precioFinal: "150",
          });

          // Item 2: uses costoInsumosConIva
          expect(items![1]!.ultimaCotizacion).toEqual({
            costoConIva: "242",
            precioFinal: "363",
          });

          // Item 3: unquoted
          expect(items![2]!.ultimaCotizacion).toBeNull();

          completed = true;
          throw new RollbackSentinel();
        },
        { timeout: 15_000 },
      );
    } catch (e) {
      if (!(e instanceof RollbackSentinel)) throw e;
    }

    expect(completed).toBe(true);
  });
});
