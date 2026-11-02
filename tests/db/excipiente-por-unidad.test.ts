/**
 * DB tests for excipiente por unidad (migration 0113, openspec/specs/excipiente-preparacion/spec.md):
 * - Reserving por unidad stores the total after subtraction (weight × units − drogas), the per-unidad amount, and the formula text per dosis ("Ludipress 0,795 g").
 * - Reserving c.s.p. stores the total after subtraction (weight − drogas) with excipiente_cantidad_por_unidad NULL and the droga name alone ("Ludipress").
 * - Refusal when the weight does not exceed the drogas (total <= 0).
 * - Formas not counted by units (CREMA) refuse "por unidad" both when reserving and in unidadesParaExcipiente.
 * - INV-P08: preparacion.excipiente_cantidad_por_unidad cannot be modified once the preparación is not INICIADA.
 * - getFichaParaImprimir returns the subtracted total and detalle for a per-unidad borrador and for an active preparación.
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
  insertComponente,
  insertFicha,
  insertLinea,
  crearPartidaConIngreso,
  insertTenant,
} from "./fixtures";
import { dec } from "@/shared/decimal";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { reservarExcipienteEnTx, unidadesParaExcipiente } from "@/modules/preparaciones/application/excipiente-preparacion";
import { upsertExcipienteBorrador } from "@/modules/preparaciones/infrastructure/preparacion-repository";
import { getFichaParaImprimir } from "@/modules/elaboracion/infrastructure/ficha-repository";

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
  session: AuthenticatedSession;
}

async function setupBase(tx: Prisma.TransactionClient): Promise<SeedContext> {
  const c = fixtureClient(tx);
  const tenantId = await insertTenant(c, "excuni");
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
  await crearPartidaConIngreso(c, {
    tenantId,
    drogaId: excipienteDrogaId,
    proveedorId,
    registradoPorId: sistema,
    cantidadInicial: 500,
  });
  await crearPartidaConIngreso(c, {
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

  const session: AuthenticatedSession = {
    sesionId: "ses-excuni",
    tenantId,
    usuario: { id: sistema, email: "sistema@fsj.test", nombre: "Sistema", apellido: "FSJ" },
    permisos: new Set(["preparaciones.iniciar", "preparaciones.confirmar"]),
  } as unknown as AuthenticatedSession;

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
    session,
  };
}

describe.skipIf(dbTestSkipReason() !== null)("DB tests: excipiente por unidad (migration 0113)", () => {
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

  it("reserving por unidad stores the total after subtraction, the per-unidad amount, and the formula text per dosis", async (ctx) => {
    if (!migration0113Applied) {
      ctx.skip("migration 0113 not applied");
      return;
    }

    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const s = await setupBase(tx);

          // Worked example: 30 cápsulas of 0.5 dosis (15 dosis).
          // Minoxidil: 75 mg cantidad_a_pesar = 0.075 g de droga.
          // Typed per unidad 0.4 g => cargado 12 g − 0.075 g = 11.925 g total to weigh,
          // 0.3975 g per cápsula, 0.795 g per dosis.
          const itemId = await insertItemReceta(s.c, {
            tenantId: s.tenantId,
            recetaId: s.recetaId,
            formaFarmaceutica: "CAPSULA",
            cantidadUnidades: 30,
            fraccionDosisPorUnidad: 0.5,
          });
          await insertComponente(s.c, {
            tenantId: s.tenantId,
            itemRecetaId: itemId,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            modoExpresion: "POR_DOSIS",
            cantidad: 5,
          });
          const fichaId = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, generadaPorId: s.sistema });
          await insertLinea(s.c, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaId,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            cantidadAPesar: 75,
          });

          const resPrep = await s.c.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_por_id)
             VALUES ($1, $2, $3, 'INICIADA', $4) RETURNING id`,
            [s.tenantId, fichaId, itemId, s.sistema],
          );
          const preparacionId = resPrep.rows[0].id as string;

          const resumen = await reservarExcipienteEnTx(tx, s.session, {
            preparacionId,
            fichaTecnicaId: fichaId,
            excipiente: {
              drogaId: s.excipienteDrogaId,
              cantidad: dec("0.4"),
              porUnidad: true,
            },
            jornada: "2026-10-30",
          });

          expect(resumen?.cantidad).toBe("11.925 g");
          expect(resumen?.porUnidad).toEqual({ cantidad: "0.3975 g", unidades: "30" });
          expect(resumen?.cargado).toBe("0.4 g por cápsula");
          expect(resumen?.drogasRestadas).toBe("0.075 g");

          const prepRow = await tx.preparacion.findUnique({
            where: { id: preparacionId, tenantId: s.tenantId },
            select: {
              excipienteDrogaId: true,
              excipienteCantidad: true,
              excipienteCantidadPorUnidad: true,
              excipienteTexto: true,
            },
          });
          expect(prepRow?.excipienteDrogaId).toBe(s.excipienteDrogaId);
          expect(prepRow?.excipienteCantidad?.toString()).toBe("11.925");
          expect(prepRow?.excipienteCantidadPorUnidad?.toString()).toBe("0.3975");
          expect(prepRow?.excipienteTexto).toBe("Ludipress 0,795 g");

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

  it("reserving c.s.p. stores the total after subtraction, with excipiente_cantidad_por_unidad NULL and droga name alone", async (ctx) => {
    if (!migration0113Applied) {
      ctx.skip("migration 0113 not applied");
      return;
    }

    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const s = await setupBase(tx);

          // Worked example: 30 cápsulas of 0.5 dosis (15 dosis).
          // Minoxidil: 75 mg cantidad_a_pesar = 0.075 g de droga.
          // Typed c.s.p. 12 g => 12 g − 0.075 g = 11.925 g total to weigh, porUnidad null, excipienteTexto "Ludipress".
          const itemId = await insertItemReceta(s.c, {
            tenantId: s.tenantId,
            recetaId: s.recetaId,
            formaFarmaceutica: "CAPSULA",
            cantidadUnidades: 30,
            fraccionDosisPorUnidad: 0.5,
          });
          await insertComponente(s.c, {
            tenantId: s.tenantId,
            itemRecetaId: itemId,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            modoExpresion: "POR_DOSIS",
            cantidad: 5,
          });
          const fichaId = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, generadaPorId: s.sistema });
          await insertLinea(s.c, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaId,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            cantidadAPesar: 75,
          });

          const resPrep = await s.c.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_por_id)
             VALUES ($1, $2, $3, 'INICIADA', $4) RETURNING id`,
            [s.tenantId, fichaId, itemId, s.sistema],
          );
          const preparacionId = resPrep.rows[0].id as string;

          const resumen = await reservarExcipienteEnTx(tx, s.session, {
            preparacionId,
            fichaTecnicaId: fichaId,
            excipiente: {
              drogaId: s.excipienteDrogaId,
              cantidad: dec("12"),
              porUnidad: false,
            },
            jornada: "2026-10-30",
          });

          expect(resumen?.cantidad).toBe("11.925 g");
          expect(resumen?.porUnidad).toBeUndefined();
          expect(resumen?.cargado).toBe("12 g");
          expect(resumen?.drogasRestadas).toBe("0.075 g");

          const prepRow = await tx.preparacion.findUnique({
            where: { id: preparacionId, tenantId: s.tenantId },
            select: {
              excipienteDrogaId: true,
              excipienteCantidad: true,
              excipienteCantidadPorUnidad: true,
              excipienteTexto: true,
            },
          });
          expect(prepRow?.excipienteDrogaId).toBe(s.excipienteDrogaId);
          expect(prepRow?.excipienteCantidad?.toString()).toBe("11.925");
          expect(prepRow?.excipienteCantidadPorUnidad).toBeNull();
          expect(prepRow?.excipienteTexto).toBe("Ludipress");

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

  it("refuses reservation when typed weight does not exceed the drogas", async (ctx) => {
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
          const fichaId = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, generadaPorId: s.sistema });
          await insertLinea(s.c, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaId,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            cantidadAPesar: 75, // 0.075 g de droga
          });

          const resPrep = await s.c.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_por_id)
             VALUES ($1, $2, $3, 'INICIADA', $4) RETURNING id`,
            [s.tenantId, fichaId, itemId, s.sistema],
          );
          const preparacionId = resPrep.rows[0].id as string;

          // 1. Refused when c.s.p. total weight is <= drogas (0.075 g <= 0.075 g)
          await expect(
            reservarExcipienteEnTx(tx, s.session, {
              preparacionId,
              fichaTecnicaId: fichaId,
              excipiente: {
                drogaId: s.excipienteDrogaId,
                cantidad: dec("0.075"),
                porUnidad: false,
              },
              jornada: "2026-10-30",
            }),
          ).rejects.toThrow("El peso cargado (0,075 g) no alcanza para las drogas (0,075 g).");

          // 2. Refused when per-unidad weight × units is <= drogas (0.002 g × 30 = 0.06 g < 0.075 g)
          await expect(
            reservarExcipienteEnTx(tx, s.session, {
              preparacionId,
              fichaTecnicaId: fichaId,
              excipiente: {
                drogaId: s.excipienteDrogaId,
                cantidad: dec("0.002"),
                porUnidad: true,
              },
              jornada: "2026-10-30",
            }),
          ).rejects.toThrow("El peso cargado (0,002 g por cápsula) no alcanza para las drogas (0,075 g).");

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

  it("por unidad on a CREMA is refused both when reserving and in unidadesParaExcipiente", async (ctx) => {
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
          const fichaId = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, generadaPorId: s.sistema });
          await insertLinea(s.c, { tenantId: s.tenantId, fichaTecnicaId: fichaId, drogaId: s.activoDrogaId, unidadMedidaId: s.unidadMg, cantidadAPesar: 10 });

          const resPrep = await s.c.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_por_id)
             VALUES ($1, $2, $3, 'INICIADA', $4) RETURNING id`,
            [s.tenantId, fichaId, itemId, s.sistema],
          );
          const preparacionId = resPrep.rows[0].id as string;

          // Refused in unidadesParaExcipiente (used by guardar-borrador and reservar)
          await expect(
            unidadesParaExcipiente(tx, s.tenantId, fichaId),
          ).rejects.toThrow("Esta forma farmacéutica no se cuenta por unidades: cargá el excipiente como c.s.p. (el peso total).");

          // Refused when reserving
          await expect(
            reservarExcipienteEnTx(tx, s.session, {
              preparacionId,
              fichaTecnicaId: fichaId,
              excipiente: {
                drogaId: s.excipienteDrogaId,
                cantidad: dec("0.8"),
                porUnidad: true,
              },
              jornada: "2026-10-30",
            }),
          ).rejects.toThrow("Esta forma farmacéutica no se cuenta por unidades: cargá el excipiente como c.s.p. (el peso total).");

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

  it("INV-P08: excipiente_cantidad_por_unidad cannot change once the preparación is not INICIADA", async (ctx) => {
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
          const fichaId = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemId, generadaPorId: s.sistema });
          await insertLinea(s.c, { tenantId: s.tenantId, fichaTecnicaId: fichaId, drogaId: s.activoDrogaId, unidadMedidaId: s.unidadMg, cantidadAPesar: 10 });

          const resPrep = await s.c.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_por_id)
             VALUES ($1, $2, $3, 'INICIADA', $4) RETURNING id`,
            [s.tenantId, fichaId, itemId, s.sistema],
          );
          const preparacionId = resPrep.rows[0].id as string;

          // Transition to CONFIRMADA (requires confirmada_en and preparada_por_id)
          await s.c.query(
            `UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`,
            [s.sistema, preparacionId],
          );

          await tx.$executeRawUnsafe("SAVEPOINT inv_p08_check");
          let invP08Blocked = false;
          let invP08Error = "";
          try {
            await tx.$executeRaw`
              UPDATE fsj.preparacion
              SET excipiente_cantidad_por_unidad = 0.5
              WHERE id = ${preparacionId}::uuid
            `;
          } catch (e: unknown) {
            invP08Blocked = true;
            invP08Error = String(e);
          } finally {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT inv_p08_check");
          }
          expect(invP08Blocked).toBe(true);
          expect(invP08Error).toContain("INV-P08");

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

  it("getFichaParaImprimir returns subtracted total and detalle for a per-unidad borrador and for an active preparación", async (ctx) => {
    if (!migration0113Applied) {
      ctx.skip("migration 0113 not applied");
      return;
    }

    let completed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const s = await setupBase(tx);

          // 1. Per-unidad borrador with no preparación started
          const itemBorradorId = await insertItemReceta(s.c, {
            tenantId: s.tenantId,
            recetaId: s.recetaId,
            formaFarmaceutica: "CAPSULA",
            cantidadUnidades: 30,
            fraccionDosisPorUnidad: 0.5,
          });
          await insertComponente(s.c, {
            tenantId: s.tenantId,
            itemRecetaId: itemBorradorId,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            modoExpresion: "POR_DOSIS",
            cantidad: 5,
          });
          const fichaBorradorId = await insertFicha(s.c, { tenantId: s.tenantId, itemRecetaId: itemBorradorId, generadaPorId: s.sistema });
          await insertLinea(s.c, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaBorradorId,
            drogaId: s.activoDrogaId,
            unidadMedidaId: s.unidadMg,
            cantidadAPesar: 75, // 0.075 g drogas
          });

          // Typed 0.4 g per cápsula => total 11.925 g
          await upsertExcipienteBorrador(tx, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaBorradorId,
            drogaId: s.excipienteDrogaId,
            cantidad: "0.4",
            porUnidad: true,
            actualizadoPorId: s.sistema,
          });

          const fichaBorradorImpresa = await getFichaParaImprimir(tx, s.tenantId, fichaBorradorId);
          expect(fichaBorradorImpresa).not.toBeNull();
          const excipienteBorradorFila = fichaBorradorImpresa?.insumos.find((i) => i.nombre === "Ludipress");
          expect(excipienteBorradorFila).toBeDefined();
          expect(excipienteBorradorFila?.cantidad).toBe("11.925");
          expect(excipienteBorradorFila?.unidadSimbolo).toBe("g");
          expect(excipienteBorradorFila?.detalle).toBe("= 0,3975 g por cápsula");

          // c.s.p. borrador: detalle is null
          await upsertExcipienteBorrador(tx, {
            tenantId: s.tenantId,
            fichaTecnicaId: fichaBorradorId,
            drogaId: s.excipienteDrogaId,
            cantidad: "12",
            porUnidad: false,
            actualizadoPorId: s.sistema,
          });
          const fichaCspBorrador = await getFichaParaImprimir(tx, s.tenantId, fichaBorradorId);
          const excipienteCspFila = fichaCspBorrador?.insumos.find((i) => i.nombre === "Ludipress");
          expect(excipienteCspFila?.cantidad).toBe("11.925");
          expect(excipienteCspFila?.detalle).toBeNull();

          // 2. Active preparación with per-unidad excipiente
          const resPrep = await s.c.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_por_id)
             VALUES ($1, $2, $3, 'INICIADA', $4) RETURNING id`,
            [s.tenantId, fichaBorradorId, itemBorradorId, s.sistema],
          );
          const preparacionId = resPrep.rows[0].id as string;

          await reservarExcipienteEnTx(tx, s.session, {
            preparacionId,
            fichaTecnicaId: fichaBorradorId,
            excipiente: {
              drogaId: s.excipienteDrogaId,
              cantidad: dec("0.4"),
              porUnidad: true,
            },
            jornada: "2026-10-30",
          });

          const fichaPrepImpresa = await getFichaParaImprimir(tx, s.tenantId, fichaBorradorId);
          const excipientePrepFila = fichaPrepImpresa?.insumos.find((i) => i.nombre === "Ludipress");
          expect(excipientePrepFila).toBeDefined();
          expect(excipientePrepFila?.cantidad).toBe("11.925");
          expect(excipientePrepFila?.unidadSimbolo).toBe("g");
          expect(excipientePrepFila?.detalle).toBe("= 0,3975 g por cápsula");

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
