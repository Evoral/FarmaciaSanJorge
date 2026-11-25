/**
 * DB tests for `getFichaYPesadaDeTomaEnTx` (openspec/specs/unidad-internacional/spec.md UI11,
 * modules/preparaciones/application/imprimir-ficha-de-toma.ts):
 *   1. CONFIRMADA uses its EGRESO_PREPARACION movements with the stored factor (`potencia_aplicada` / `actividad_aplicada`),
 *      or MANUAL when `equivalencia_manual = true`.
 *   2. INICIADA uses its `reserva_stock` rows (skips "0" rows).
 *   3. No preparación uses the `pesada_borrador` chosen lots when they cover the línea, else the automatic split.
 *   4. A marked U.I. droga with no U.I. lot gives MANUAL.
 *   5. A línea whose lots are all at 100 % is left out of the map.
 *   6. Enrase manual and faltante líneas are left out.
 *
 * Runs inside rolled-back interactive transactions; zero rows persist.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import {
  createSistemaUser,
  crearLibrosRubricados,
  crearPartidaConIngreso,
  FUTURO,
  insertDroga,
  insertFicha,
  insertItemReceta,
  insertLinea,
  insertMedico,
  insertPaciente,
  insertProveedor,
  insertReceta,
  insertTenant,
} from "./fixtures";
import { getFichaYPesadaDeTomaEnTx } from "@/modules/preparaciones/application/imprimir-ficha-de-toma";

class RollbackSentinel extends Error {}

function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

describe.skipIf(dbTestSkipReason() !== null)("Imprimir ficha de toma (UI11)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function inTx(fn: (tx: Prisma.TransactionClient, c: Client) => Promise<void>): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await fn(tx, fixtureClient(tx));
        throw new RollbackSentinel();
      });
    } catch (e) {
      if (!(e instanceof RollbackSentinel)) throw e;
    }
  }

  async function setupTenantConReceta(tx: Prisma.TransactionClient, c: Client, suffix: string) {
    const tenantId = await insertTenant(c, suffix);
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const sistema = await createSistemaUser(c, tenantId);
    await crearLibrosRubricados(c, tenantId, sistema);
    const codG = `U_G_${randomUUID().slice(0, 8)}`;
    const unidadG = (
      await c.query(
        `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
         VALUES ($1, 'Gramo Test', 'g', 'MASA', 1, false) RETURNING id`,
        [codG],
      )
    ).rows[0]!.id as string;
    const uiRes = await c.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = 'UNIDAD_INTERNACIONAL'`);
    const unidadUi = uiRes.rows[0]!.id as string;
    const pacienteId = await insertPaciente(c, tenantId);
    const medicoId = await insertMedico(c, tenantId);
    const proveedorId = await insertProveedor(c, tenantId);
    const recetaId = await insertReceta(c, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
    const itemRecetaId = await insertItemReceta(c, { tenantId, recetaId });
    const fichaId = await insertFicha(c, { tenantId, itemRecetaId, generadaPorId: sistema });
    return { tenantId, sistema, unidadG, unidadUi, proveedorId, recetaId, itemRecetaId, fichaId };
  }

  it("CONFIRMADA uses EGRESO_PREPARACION movements with their stored factor (and omits 100 % lines)", async () => {
    await inTx(async (tx, c) => {
      const { tenantId, sistema, unidadG, unidadUi, proveedorId, fichaId } = await setupTenantConReceta(tx, c, "ift_conf");

      const drogaUiRes = await c.query(
        `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
         VALUES ($1, 'Vitamina D3', $2, 'DROGA', true) RETURNING id`,
        [tenantId, unidadG],
      );
      const drogaUi = drogaUiRes.rows[0]!.id as string;
      const droga100 = await insertDroga(c, tenantId, unidadG);

      const lineaUi = await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: drogaUi,
        unidadMedidaId: unidadUi,
        cantidadTeorica: 500000,
        cantidadAPesar: 500000,
        orden: 1,
      });
      const linea100 = await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: droga100,
        unidadMedidaId: unidadG,
        cantidadTeorica: 5,
        cantidadAPesar: 5,
        orden: 2,
      });

      const pUiRes = await c.query(
        `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
         VALUES ($1, $2, $3, 'L-UI-CONF', 100, 50, $4, 100000) RETURNING id`,
        [tenantId, drogaUi, proveedorId, FUTURO],
      );
      const partidaUi = pUiRes.rows[0]!.id as string;
      await c.query(
        `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id) VALUES ($1, $2, 'INGRESO_COMPRA', 50, $3)`,
        [tenantId, partidaUi, sistema],
      );
      const partida100 = await crearPartidaConIngreso(c, {
        tenantId,
        drogaId: droga100,
        proveedorId,
        registradoPorId: sistema,
        cantidadInicial: 50,
        fechaVencimiento: FUTURO,
      });

      const prepRes = await c.query(
        `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, fichaId, sistema],
      );
      const prepId = prepRes.rows[0]!.id as string;

      // Egreso with stored actividad_aplicada = 100000 (even if partida is later updated, snapshot wins)
      await c.query(
        `INSERT INTO fsj.movimiento_stock
           (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id, actividad_aplicada)
         VALUES ($1, $2, 'EGRESO_PREPARACION', 5, $3, $4, $5, 100000)`,
        [tenantId, partidaUi, prepId, lineaUi, sistema],
      );
      await c.query(
        `INSERT INTO fsj.movimiento_stock
           (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id, potencia_aplicada)
         VALUES ($1, $2, 'EGRESO_PREPARACION', 5, $3, $4, $5, 100)`,
        [tenantId, partida100, prepId, linea100, sistema],
      );
      await c.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', preparada_por_id = $1, confirmada_en = now() WHERE id = $2`, [
        sistema,
        prepId,
      ]);

      const { pesada } = await getFichaYPesadaDeTomaEnTx(tx, tenantId, fichaId);
      expect(pesada.get(1)).toEqual({
        tipo: "LOTES",
        lotes: [{ lote: "L-UI-CONF", cantidad: "5", unidadSimbolo: "g", factor: "100.000 U.I./g" }],
      });
      // 100 % lot line is omitted
      expect(pesada.has(2)).toBe(false);
    });
  });

  it("INICIADA uses its reservas and skips '0' rows", async () => {
    await inTx(async (tx, c) => {
      const { tenantId, sistema, unidadG, proveedorId, fichaId } = await setupTenantConReceta(tx, c, "ift_inic");
      const droga98 = await insertDroga(c, tenantId, unidadG);
      const lineaId = await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: droga98,
        unidadMedidaId: unidadG,
        cantidadTeorica: 9.8,
        cantidadAPesar: 9.8,
        orden: 1,
      });

      const p1Res = await c.query(
        `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
         VALUES ($1, $2, $3, 'L-98-A', 100, 50, $4, 98) RETURNING id`,
        [tenantId, droga98, proveedorId, FUTURO],
      );
      const p2Res = await c.query(
        `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
         VALUES ($1, $2, $3, 'L-98-ZERO', 100, 50, $4, 98) RETURNING id`,
        [tenantId, droga98, proveedorId, FUTURO],
      );
      const p1 = p1Res.rows[0]!.id as string;
      const p2 = p2Res.rows[0]!.id as string;
      for (const pid of [p1, p2]) {
        await c.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id) VALUES ($1, $2, 'INGRESO_COMPRA', 50, $3)`,
          [tenantId, pid, sistema],
        );
      }

      const prepRes = await c.query(
        `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, fichaId, sistema],
      );
      const prepId = prepRes.rows[0]!.id as string;

      await c.query(
        `INSERT INTO fsj.reserva_stock (tenant_id, preparacion_id, partida_id, linea_pesaje_id, cantidad, reservada_por_id)
         VALUES ($1, $2, $3, $4, 10, $6), ($1, $2, $5, $4, 0, $6)`,
        [tenantId, prepId, p1, lineaId, p2, sistema],
      );

      const { pesada } = await getFichaYPesadaDeTomaEnTx(tx, tenantId, fichaId);
      expect(pesada.get(1)).toEqual({
        tipo: "LOTES",
        lotes: [{ lote: "L-98-A", cantidad: "10", unidadSimbolo: "g", factor: "98 %" }],
      });
    });
  });

  it("no preparación uses pesada_borrador chosen lots when they cover, else automatic split; U.I. without U.I. lot -> MANUAL; enrase/faltante/100% -> omitted", async () => {
    await inTx(async (tx, c) => {
      const { tenantId, sistema, unidadG, unidadUi, proveedorId, fichaId } = await setupTenantConReceta(tx, c, "ift_borr");

      const drogaBorrador = await insertDroga(c, tenantId, unidadG);
      const drogaAuto = await insertDroga(c, tenantId, unidadG);
      const drogaUiSinLoteRes = await c.query(
        `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
         VALUES ($1, 'Vitamina E', $2, 'DROGA', true) RETURNING id`,
        [tenantId, unidadG],
      );
      const drogaUiSinLote = drogaUiSinLoteRes.rows[0]!.id as string;
      const droga100 = await insertDroga(c, tenantId, unidadG);
      const drogaFaltante = await insertDroga(c, tenantId, unidadG);
      const drogaEnrase = await insertDroga(c, tenantId, unidadG);

      // 1: Borrador chooses L-CHOSEN (80 % purity) over L-FEFO (90 % purity)
      const linea1 = await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: drogaBorrador,
        unidadMedidaId: unidadG,
        cantidadTeorica: 8,
        cantidadAPesar: 8,
        orden: 1,
      });
      // 2: Borrador chooses insufficient lot -> falls back to automatic split
      const linea2 = await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: drogaAuto,
        unidadMedidaId: unidadG,
        cantidadTeorica: 9,
        cantidadAPesar: 9,
        orden: 2,
      });
      // 3: Marked U.I. droga with only gram lot -> MANUAL
      await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: drogaUiSinLote,
        unidadMedidaId: unidadUi,
        cantidadTeorica: 1000,
        cantidadAPesar: 1000,
        orden: 3,
      });
      // 4: 100 % purity -> omitted
      await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: droga100,
        unidadMedidaId: unidadG,
        cantidadTeorica: 5,
        cantidadAPesar: 5,
        orden: 4,
      });
      // 5: Faltante (not enough stock) -> omitted
      await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: drogaFaltante,
        unidadMedidaId: unidadG,
        cantidadTeorica: 100,
        cantidadAPesar: 100,
        orden: 5,
      });
      // 6: Enrase manual -> omitted
      await insertLinea(c, {
        tenantId,
        fichaTecnicaId: fichaId,
        drogaId: drogaEnrase,
        unidadMedidaId: unidadG,
        esEnraseManual: true,
        orden: 6,
      });

      // Partidas for línea 1
      const p1Fefo = (
        await c.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
           VALUES ($1, $2, $3, 'L-FEFO', 100, 50, '2098-01-01', 90) RETURNING id`,
          [tenantId, drogaBorrador, proveedorId],
        )
      ).rows[0]!.id as string;
      const p1Chosen = (
        await c.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
           VALUES ($1, $2, $3, 'L-CHOSEN', 100, 50, '2099-01-01', 80) RETURNING id`,
          [tenantId, drogaBorrador, proveedorId],
        )
      ).rows[0]!.id as string;

      // Partidas for línea 2
      const p2Small = (
        await c.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
           VALUES ($1, $2, $3, 'L-SMALL', 100, 2, '2099-01-01', 90) RETURNING id`,
          [tenantId, drogaAuto, proveedorId],
        )
      ).rows[0]!.id as string;
      const p2Big = (
        await c.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
           VALUES ($1, $2, $3, 'L-BIG', 100, 50, '2099-06-01', 90) RETURNING id`,
          [tenantId, drogaAuto, proveedorId],
        )
      ).rows[0]!.id as string;

      // Gram lot for U.I. droga (incompatible -> MANUAL)
      const p3Gram = await crearPartidaConIngreso(c, {
        tenantId,
        drogaId: drogaUiSinLote,
        proveedorId,
        registradoPorId: sistema,
        cantidadInicial: 50,
        fechaVencimiento: FUTURO,
      });
      void p3Gram;

      // 100 % lot for línea 4
      await crearPartidaConIngreso(c, {
        tenantId,
        drogaId: droga100,
        proveedorId,
        registradoPorId: sistema,
        cantidadInicial: 50,
        fechaVencimiento: FUTURO,
      });

      // Small lot (1 g) for línea 5 (needs 100 g -> faltante)
      await crearPartidaConIngreso(c, {
        tenantId,
        drogaId: drogaFaltante,
        proveedorId,
        registradoPorId: sistema,
        cantidadInicial: 1,
        fechaVencimiento: FUTURO,
      });

      for (const [pid, qty] of [
        [p1Fefo, 50],
        [p1Chosen, 50],
        [p2Small, 2],
        [p2Big, 50],
      ] as const) {
        await c.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id) VALUES ($1, $2, 'INGRESO_COMPRA', $3, $4)`,
          [tenantId, pid, qty, sistema],
        );
      }

      // Borradores: línea 1 chooses L-CHOSEN (covers 8g @ 80% = 10g); línea 2 chooses L-SMALL (2g < 10g -> falls back to auto split)
      await c.query(
        `INSERT INTO fsj.pesada_borrador (tenant_id, linea_pesaje_id, partida_ids, actualizado_por_id)
         VALUES ($1, $2, ARRAY[$3]::uuid[], $6), ($1, $4, ARRAY[$5]::uuid[], $6)`,
        [tenantId, linea1, p1Chosen, linea2, p2Small, sistema],
      );

      const { pesada } = await getFichaYPesadaDeTomaEnTx(tx, tenantId, fichaId);

      // 1: borrador chosen lot
      expect(pesada.get(1)).toEqual({
        tipo: "LOTES",
        lotes: [{ lote: "L-CHOSEN", cantidad: "10", unidadSimbolo: "g", factor: "80 %" }],
      });
      // 2: automatic split (2 g from L-SMALL + 8 g from L-BIG)
      expect(pesada.get(2)).toEqual({
        tipo: "LOTES",
        lotes: [
          { lote: "L-SMALL", cantidad: "2", unidadSimbolo: "g", factor: "90 %" },
          { lote: "L-BIG", cantidad: "8", unidadSimbolo: "g", factor: "90 %" },
        ],
      });
      // 3: U.I. droga with no U.I. lot -> MANUAL
      expect(pesada.get(3)).toEqual({
        tipo: "MANUAL",
        cantidad: null,
        unidadSimbolo: "g",
      });
      // 4 (100 %), 5 (faltante), 6 (enrase manual) -> omitted
      expect(pesada.has(4)).toBe(false);
      expect(pesada.has(5)).toBe(false);
      expect(pesada.has(6)).toBe(false);
    });
  });
});
