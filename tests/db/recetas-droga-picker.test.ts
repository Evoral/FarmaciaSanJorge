/**
 * DB tests for receta droga picker (modules/recetas/infrastructure/receta-repository.ts listDrogasParaReceta).
 *
 * Verifies that:
 * 1. Given droga "Ac. Citronella" with synonym "Citronella", searching "citronella"
 *    offers "Citronella ≈ Ac. Citronella" first (exact match on synonym) and "Ac. Citronella" second.
 *    The first option carries sinonimo + sinonimoId (which is stored as drogaAliasId), while the second has null.
 * 2. Calling listDrogasParaReceta with no search query returns only name options (sinonimo: null, sinonimoId: null).
 * 3. A dado de baja synonym or droga is not offered.
 * 4. MATERIAL drogas are not offered.
 *
 * Runs inside a rolled-back Prisma interactive transaction (zero rows persist).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { insertTenant, createSistemaUser, insertUnidad } from "./fixtures";
import { listDrogasParaReceta } from "@/modules/recetas/infrastructure/receta-repository";
import { normalizarTexto } from "@/modules/drogas/domain/normalizar";

class RollbackSentinel extends Error {}

function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

async function insertDrogaTest(
  c: Client,
  input: {
    tenantId: string;
    nombre: string;
    unidadBaseId: string;
    clase?: "DROGA" | "EXCIPIENTE" | "MATERIAL";
    fechaBaja?: Date | null;
  },
): Promise<string> {
  const res = await c.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, fecha_baja)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.tenantId,
      input.nombre,
      input.unidadBaseId,
      input.clase ?? "DROGA",
      input.fechaBaja ?? null,
    ],
  );
  return res.rows[0].id as string;
}

async function insertSinonimoTest(
  c: Client,
  input: {
    tenantId: string;
    drogaId: string;
    texto: string;
    creadoPorId: string;
    fechaBaja?: Date | null;
  },
): Promise<string> {
  const res = await c.query(
    `INSERT INTO fsj.droga_alias (tenant_id, droga_id, texto, alias_normalizado, creado_por_id, fecha_baja)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.tenantId,
      input.drogaId,
      input.texto,
      normalizarTexto(input.texto),
      input.creadoPorId,
      input.fechaBaja ?? null,
    ],
  );
  return res.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("DB tests: listDrogasParaReceta (modules/recetas/infrastructure/receta-repository)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("receta droga picker: synonym exact match first, no search returns only names, excludes bajas and MATERIAL", async () => {
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const c = fixtureClient(tx);
          const tenantId = await insertTenant(c, "drg-pck");
          const userId = await createSistemaUser(c, tenantId);
          const unidadId = await insertUnidad(c, "g");

          // 1. Given droga "Ac. Citronella" with synonym "Citronella"
          const drogaCitronellaId = await insertDrogaTest(c, {
            tenantId,
            nombre: "Ac. Citronella",
            unidadBaseId: unidadId,
            clase: "DROGA",
          });
          const sinonimoCitronellaId = await insertSinonimoTest(c, {
            tenantId,
            drogaId: drogaCitronellaId,
            texto: "Citronella",
            creadoPorId: userId,
          });

          // 2. Control droga: "Ibuprofeno" with vigente synonym "Advil"
          const drogaIbuprofenoId = await insertDrogaTest(c, {
            tenantId,
            nombre: "Ibuprofeno",
            unidadBaseId: unidadId,
            clase: "DROGA",
          });
          await insertSinonimoTest(c, {
            tenantId,
            drogaId: drogaIbuprofenoId,
            texto: "Advil",
            creadoPorId: userId,
          });

          // 3. Dado de baja synonym on "Ac. Citronella"
          await insertSinonimoTest(c, {
            tenantId,
            drogaId: drogaCitronellaId,
            texto: "Esencia Citronella",
            creadoPorId: userId,
            fechaBaja: new Date(),
          });

          // 4. Dado de baja droga with synonym
          const drogaBajaId = await insertDrogaTest(c, {
            tenantId,
            nombre: "Citronella Inactiva",
            unidadBaseId: unidadId,
            fechaBaja: new Date(),
          });
          await insertSinonimoTest(c, {
            tenantId,
            drogaId: drogaBajaId,
            texto: "Citronella Muerta",
            creadoPorId: userId,
          });

          // 5. MATERIAL droga (should never be offered)
          const materialId = await insertDrogaTest(c, {
            tenantId,
            nombre: "Capsula Citronella",
            unidadBaseId: unidadId,
            clase: "MATERIAL",
          });
          await insertSinonimoTest(c, {
            tenantId,
            drogaId: materialId,
            texto: "Envase Citronella",
            creadoPorId: userId,
          });

          // ------------------------------------------------------------------
          // Scenario 1: WHEN the receta picker searches "citronella"
          // THEN it offers "Citronella ≈ Ac. Citronella" first and "Ac. Citronella" second
          // ------------------------------------------------------------------
          const resultadosCitronella = await listDrogasParaReceta(tx, tenantId, "citronella");
          expect(resultadosCitronella.length).toBe(2);

          // First option: synonym match (exact match on "citronella")
          expect(resultadosCitronella[0]).toEqual({
            id: drogaCitronellaId,
            nombre: "Ac. Citronella",
            unidadBaseId: unidadId,
            unidadBaseSimbolo: "x",
            sinonimo: "Citronella",
            sinonimoId: sinonimoCitronellaId,
          });

          // Second option: canonical name match ("citronella" is substring of "ac. citronella")
          expect(resultadosCitronella[1]).toEqual({
            id: drogaCitronellaId,
            nombre: "Ac. Citronella",
            unidadBaseId: unidadId,
            unidadBaseSimbolo: "x",
            sinonimo: null,
            sinonimoId: null,
          });

          // ------------------------------------------------------------------
          // Scenario 2: No search returns only name options
          // ------------------------------------------------------------------
          const resultadosSinBusqueda = await listDrogasParaReceta(tx, tenantId);
          // Must return vigente DROGA/EXCIPIENTE drogas, but ZERO synonym rows
          expect(resultadosSinBusqueda.length).toBeGreaterThan(0);
          for (const opcion of resultadosSinBusqueda) {
            expect(opcion.sinonimo).toBeNull();
            expect(opcion.sinonimoId).toBeNull();
          }
          const idsSinBusqueda = resultadosSinBusqueda.map((o) => o.id);
          expect(idsSinBusqueda).toContain(drogaCitronellaId);
          expect(idsSinBusqueda).toContain(drogaIbuprofenoId);

          // ------------------------------------------------------------------
          // Scenario 3: A dado de baja synonym or droga is not offered
          // ------------------------------------------------------------------
          // 3a. Searching by the dado de baja synonym text
          const resultadosSinonimoBaja = await listDrogasParaReceta(tx, tenantId, "esencia citronella");
          expect(resultadosSinonimoBaja).toEqual([]);

          // 3b. Searching by the dado de baja droga name or its synonym
          const resultadosDrogaBaja = await listDrogasParaReceta(tx, tenantId, "citronella inactiva");
          expect(resultadosDrogaBaja).toEqual([]);

          const resultadosSinonimoDrogaBaja = await listDrogasParaReceta(tx, tenantId, "citronella muerta");
          expect(resultadosSinonimoDrogaBaja).toEqual([]);

          // ------------------------------------------------------------------
          // Scenario 4: MATERIAL drogas are not offered
          // ------------------------------------------------------------------
          const resultadosMaterial = await listDrogasParaReceta(tx, tenantId, "capsula");
          expect(resultadosMaterial).toEqual([]);

          const resultadosSinonimoMaterial = await listDrogasParaReceta(tx, tenantId, "envase citronella");
          expect(resultadosSinonimoMaterial).toEqual([]);

          expect(idsSinBusqueda).not.toContain(materialId);
          expect(idsSinBusqueda).not.toContain(drogaBajaId);

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
