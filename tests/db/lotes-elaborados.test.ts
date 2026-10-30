/**
 * DB tests for migration 0111_lotes_elaborados (openspec/changes/lotes-elaborados):
 * - Happy path through insertLoteElaborado for DILUCION and FORMULA:
 *   - balances move
 *   - consumed lots get opened
 *   - produced partida has origen ELABORACION_PROPIA and no proveedor
 * - Commit-time triggers reject:
 *   - INV-EL3: active produced ≠ active consumed beyond 1e-4
 *   - DILUCION with a formula_id
 *   - a FORMULA lot consuming its own droga
 *   - consuming an expired partida (INV-S10)
 * - INV-EL5: a component that has its own fórmula is rejected
 * - elaboracion_lote can be neither updated nor deleted (forbid trigger and grants)
 * - v_stock_droga.stock_activo = Σ disponible × coalesce(potencia, 100) / 100
 * - listStockDrogasSql (tests/db/stock-drogas-filtros.test.ts) and alertasBajoMinimo compare stock_activo, not stock_disponible
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import {
  asOwner,
  asApp,
  inRollbackTx,
  expectInvariantViolation,
  expectDbRejection,
  setRelojPrueba,
} from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  insertUnidad,
  insertProveedor,
  crearPartidaConIngreso,
  FUTURO,
} from "./fixtures";
import {
  listStockDrogasSql,
  type ListStockDrogasRow,
} from "@/modules/stock/infrastructure/partida-repository";

const JORNADA = "2026-10-29T12:00:00-03:00";

let migration0111Applied = false;

beforeAll(async () => {
  if (dbTestSkipReason() !== null) return;
  try {
    await asOwner(async (tx) => {
      const res = await tx.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'fsj' AND table_name = 'elaboracion_lote'`,
      );
      migration0111Applied = (res.rowCount ?? 0) > 0;
    });
  } catch {
    migration0111Applied = false;
  }
});

interface SeedElaboracion {
  tenantId: string;
  sistema: string;
  unidadG: string;
  unidadMl: string;
  drogaX: string;
  drogaLactosa: string;
  drogaJarabe: string;
  drogaAzucar: string;
  drogaAgua: string;
  proveedorId: string;
}

async function insertDrogaNamed(tx: Client, tenantId: string, unidadId: string, nombre: string): Promise<string> {
  const res = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, nombre, unidadId],
  );
  return res.rows[0].id as string;
}

async function seedBase(tx: Client): Promise<SeedElaboracion> {
  const tenantId = await insertTenant(tx, "elab");
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadG = await insertUnidad(tx, "g", "MASA", 1);
  const unidadMl = await insertUnidad(tx, "ml", "VOLUMEN", 1);
  const proveedorId = await insertProveedor(tx, tenantId);

  const drogaX = await insertDrogaNamed(tx, tenantId, unidadG, "Droga X");
  const drogaLactosa = await insertDrogaNamed(tx, tenantId, unidadG, "Lactosa");
  const drogaJarabe = await insertDrogaNamed(tx, tenantId, unidadMl, "Jarabe simple");
  const drogaAzucar = await insertDrogaNamed(tx, tenantId, unidadG, "Azúcar");
  const drogaAgua = await insertDrogaNamed(tx, tenantId, unidadMl, "Agua");

  await setRelojPrueba(tx, JORNADA);

  return {
    tenantId,
    sistema,
    unidadG,
    unidadMl,
    drogaX,
    drogaLactosa,
    drogaJarabe,
    drogaAzucar,
    drogaAgua,
    proveedorId,
  };
}

async function insertLoteElaboradoDb(
  tx: Client,
  params: {
    tenantId: string;
    drogaId: string;
    tipo: "DILUCION" | "FORMULA";
    formulaId?: string | null;
    lote: string;
    cantidadProducida: number;
    costoUnitario: number;
    potenciaDeclarada?: number | null;
    fechaVencimiento?: string | null;
    elaboradoPorId: string;
    consumos: { partidaId: string; cantidad: number }[];
  },
): Promise<{ partidaId: string; elaboracionLoteId: string }> {
  const resPartida = await tx.query(
    `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
     VALUES ($1, $2, 'ELABORACION_PROPIA', NULL, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.tenantId,
      params.drogaId,
      params.lote,
      params.costoUnitario,
      params.cantidadProducida,
      params.fechaVencimiento ?? null,
      params.potenciaDeclarada ?? null,
    ],
  );
  const partidaId = resPartida.rows[0].id as string;

  const resElab = await tx.query(
    `INSERT INTO fsj.elaboracion_lote (tenant_id, partida_id, tipo, formula_id, elaborado_por_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [params.tenantId, partidaId, params.tipo, params.formulaId ?? null, params.elaboradoPorId],
  );
  const elaboracionLoteId = resElab.rows[0].id as string;

  await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, elaboracion_lote_id)
     VALUES ($1, $2, 'INGRESO_ELABORACION', $3, $4, $5)`,
    [params.tenantId, partidaId, params.cantidadProducida, params.elaboradoPorId, elaboracionLoteId],
  );

  for (const c of params.consumos) {
    await tx.query(
      `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, elaboracion_lote_id)
       VALUES ($1, $2, 'EGRESO_ELABORACION', $3, $4, $5)`,
      [params.tenantId, c.partidaId, c.cantidad, params.elaboradoPorId, elaboracionLoteId],
    );
  }

  return { partidaId, elaboracionLoteId };
}

describe.skipIf(dbTestSkipReason() !== null)("0111 lotes elaborados DB invariants", () => {
  it("Happy path for DILUCION and FORMULA: balances move, lots get opened, produced partida has origen ELABORACION_PROPIA and no proveedor", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        // 1. DILUCION happy path: 1 g of X (pure) + 99 g Lactosa -> 100 g of X at 1 %
        const pX = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });
        const pLac = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaLactosa,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 500,
          fechaVencimiento: FUTURO,
        });

        // Initially unopened
        const aperturasAntes = await tx.query(`SELECT id, fecha_apertura FROM fsj.partida WHERE id = ANY($1)`, [
          [pX, pLac],
        ]);
        expect(aperturasAntes.rows.every((r) => r.fecha_apertura === null)).toBe(true);

        const { partidaId: pDilId } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: `E-${randomUUID().slice(0, 8)}`,
          cantidadProducida: 100,
          costoUnitario: 19.9,
          potenciaDeclarada: 1, // 1 g active / 100 g = 1%
          fechaVencimiento: FUTURO,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pX, cantidad: 1 },
            { partidaId: pLac, cantidad: 99 },
          ],
        });

        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");

        // Verify balances moved
        const rX = await tx.query(`SELECT cantidad_disponible, fecha_apertura FROM fsj.partida WHERE id = $1`, [pX]);
        expect(Number(rX.rows[0].cantidad_disponible)).toBe(9); // 10 - 1
        expect(rX.rows[0].fecha_apertura).not.toBeNull(); // opened!

        const rLac = await tx.query(`SELECT cantidad_disponible, fecha_apertura FROM fsj.partida WHERE id = $1`, [pLac]);
        expect(Number(rLac.rows[0].cantidad_disponible)).toBe(401); // 500 - 99
        expect(rLac.rows[0].fecha_apertura).not.toBeNull(); // opened!

        // Verify produced partida
        const rDil = await tx.query(
          `SELECT origen, proveedor_id, cantidad_disponible, potencia_declarada FROM fsj.partida WHERE id = $1`,
          [pDilId],
        );
        expect(rDil.rows[0].origen).toBe("ELABORACION_PROPIA");
        expect(rDil.rows[0].proveedor_id).toBeNull();
        expect(Number(rDil.rows[0].cantidad_disponible)).toBe(100);
        expect(Number(rDil.rows[0].potencia_declarada)).toBe(1);

        // 2. FORMULA happy path: Jarabe simple from Azúcar and Agua
        const resForm = await tx.query(
          `INSERT INTO fsj.formula_elaboracion (tenant_id, droga_id, cantidad_referencia, actualizada_por_id)
           VALUES ($1, $2, 100, $3) RETURNING id`,
          [seed.tenantId, seed.drogaJarabe, seed.sistema],
        );
        const formulaId = resForm.rows[0].id as string;
        await tx.query(
          `INSERT INTO fsj.formula_elaboracion_componente (tenant_id, formula_id, orden, droga_id, cantidad)
           VALUES ($1, $2, 1, $3, 85), ($1, $2, 2, $4, 46)`,
          [seed.tenantId, formulaId, seed.drogaAzucar, seed.drogaAgua],
        );

        const pAzucar = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaAzucar,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 200,
          fechaVencimiento: FUTURO,
        });
        const pAgua = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaAgua,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 200,
          fechaVencimiento: FUTURO,
        });

        const { partidaId: pJarabeId } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaJarabe,
          tipo: "FORMULA",
          formulaId,
          lote: `E-${randomUUID().slice(0, 8)}`,
          cantidadProducida: 100,
          costoUnitario: 50,
          fechaVencimiento: FUTURO,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pAzucar, cantidad: 85 },
            { partidaId: pAgua, cantidad: 46 },
          ],
        });

        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");

        const rJarabe = await tx.query(
          `SELECT origen, proveedor_id, cantidad_disponible, potencia_declarada FROM fsj.partida WHERE id = $1`,
          [pJarabeId],
        );
        expect(rJarabe.rows[0].origen).toBe("ELABORACION_PROPIA");
        expect(rJarabe.rows[0].proveedor_id).toBeNull();
        expect(Number(rJarabe.rows[0].cantidad_disponible)).toBe(100);
        expect(rJarabe.rows[0].potencia_declarada).toBeNull();
      });
    });
  });

  it("Commit-time triggers reject INV-EL3 (active produced != active consumed beyond 1e-4)", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);
        const pX = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        // Consumed 1 g active (1 g x 100%), but produced declares 5% on 100 g = 5 g active (mismatch!)
        await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: `E-${randomUUID().slice(0, 8)}`,
          cantidadProducida: 100,
          costoUnitario: 10,
          potenciaDeclarada: 5,
          fechaVencimiento: FUTURO,
          elaboradoPorId: seed.sistema,
          consumos: [{ partidaId: pX, cantidad: 1 }],
        });

        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-EL3");
      });
    });
  });

  it("DILUCION with a formula_id is rejected by CHECK constraint", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);
        await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        const resPartida = await tx.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, origen, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
           VALUES ($1, $2, 'ELABORACION_PROPIA', $3, 10, 100, $4, 1) RETURNING id`,
          [seed.tenantId, seed.drogaX, `E-${randomUUID().slice(0, 8)}`, FUTURO],
        );
        const partidaId = resPartida.rows[0].id as string;

        const dummyFormulaId = randomUUID();
        // DILUCION with non-null formula_id violates elaboracion_lote_formula_check
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.elaboracion_lote (tenant_id, partida_id, tipo, formula_id, elaborado_por_id)
               VALUES ($1, $2, 'DILUCION', $3, $4)`,
              [seed.tenantId, partidaId, dummyFormulaId, seed.sistema],
            ),
          "23514", // check_violation
        );
      });
    });
  });

  it("A FORMULA lot consuming its own droga is rejected by INV-EL3", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);
        // Partida of Jarabe
        const pJarabe = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaJarabe,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 50,
          fechaVencimiento: FUTURO,
        });

        // FORMULA lot of Jarabe consuming Jarabe itself
        await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaJarabe,
          tipo: "FORMULA",
          lote: `E-${randomUUID().slice(0, 8)}`,
          cantidadProducida: 100,
          costoUnitario: 10,
          fechaVencimiento: FUTURO,
          elaboradoPorId: seed.sistema,
          consumos: [{ partidaId: pJarabe, cantidad: 10 }],
        });

        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-EL3");
      });
    });
  });

  it("Consuming an expired partida is rejected by INV-S10", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        // Ingreso in the past, then expired at JORNADA
        await setRelojPrueba(tx, "2026-01-01T12:00:00-03:00");
        const pVencida = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: "2026-03-01",
        });
        await setRelojPrueba(tx, JORNADA);

        await expectInvariantViolation(
          tx,
          () =>
            insertLoteElaboradoDb(tx, {
              tenantId: seed.tenantId,
              drogaId: seed.drogaX,
              tipo: "DILUCION",
              lote: `E-${randomUUID().slice(0, 8)}`,
              cantidadProducida: 100,
              costoUnitario: 10,
              potenciaDeclarada: 1,
              fechaVencimiento: FUTURO,
              elaboradoPorId: seed.sistema,
              consumos: [{ partidaId: pVencida, cantidad: 1 }],
            }),
          "INV-S10",
        );
      });
    });
  });

  it("INV-EL5: a component that has its own fórmula is rejected", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        // 1. Droga Azúcar has its own formula
        const resFormAzucar = await tx.query(
          `INSERT INTO fsj.formula_elaboracion (tenant_id, droga_id, cantidad_referencia, actualizada_por_id)
           VALUES ($1, $2, 100, $3) RETURNING id`,
          [seed.tenantId, seed.drogaAzucar, seed.sistema],
        );
        const formAzucarId = resFormAzucar.rows[0].id as string;
        await tx.query(
          `INSERT INTO fsj.formula_elaboracion_componente (tenant_id, formula_id, orden, droga_id, cantidad)
           VALUES ($1, $2, 1, $3, 10)`,
          [seed.tenantId, formAzucarId, seed.drogaAgua],
        );

        // 2. Now try to add Azúcar as a component of Jarabe's formula
        const resFormJarabe = await tx.query(
          `INSERT INTO fsj.formula_elaboracion (tenant_id, droga_id, cantidad_referencia, actualizada_por_id)
           VALUES ($1, $2, 100, $3) RETURNING id`,
          [seed.tenantId, seed.drogaJarabe, seed.sistema],
        );
        const formJarabeId = resFormJarabe.rows[0].id as string;

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.formula_elaboracion_componente (tenant_id, formula_id, orden, droga_id, cantidad)
               VALUES ($1, $2, 1, $3, 85)`,
              [seed.tenantId, formJarabeId, seed.drogaAzucar],
            ),
          "INV-EL5",
        );
      });
    });
  });

  it("elaboracion_lote can be neither updated nor deleted (forbid trigger and grants)", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);
        const pX = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        const { elaboracionLoteId } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: `E-${randomUUID().slice(0, 8)}`,
          cantidadProducida: 100,
          costoUnitario: 10,
          potenciaDeclarada: 1,
          fechaVencimiento: FUTURO,
          elaboradoPorId: seed.sistema,
          consumos: [{ partidaId: pX, cantidad: 1 }],
        });

        // UPDATE rejected by trigger
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.elaboracion_lote SET observacion = 'hack' WHERE id = $1`, [elaboracionLoteId]),
          "P0001",
        );

        // DELETE rejected by trigger
        await expectDbRejection(
          tx,
          () => tx.query(`DELETE FROM fsj.elaboracion_lote WHERE id = $1`, [elaboracionLoteId]),
          "P0001",
        );
      });
    });

    // asApp lacks UPDATE / DELETE grants
    await asApp(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const fakeId = randomUUID();
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.elaboracion_lote SET observacion = 'test' WHERE id = $1`, [fakeId]),
          "42501", // insufficient_privilege
        );
        await expectDbRejection(
          tx,
          () => tx.query(`DELETE FROM fsj.elaboracion_lote WHERE id = $1`, [fakeId]),
          "42501", // insufficient_privilege
        );
      });
    });
  });

  it("v_stock_droga.stock_activo = Σ disponible × coalesce(potencia, 100) / 100", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        // Partida 1: 10 g, pure (potencia NULL -> 100% -> 10 g activo)
        await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        // Partida 2: 100 g, 1% dilución (potencia 1 -> 1 g activo)
        const resPartida2 = await tx.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
           VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 100, $4, 1) RETURNING id`,
          [seed.tenantId, seed.drogaX, `L-${randomUUID().slice(0, 8)}`, FUTURO],
        );
        const p2Id = resPartida2.rows[0].id as string;
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_INICIAL', 100, $3)`,
          [seed.tenantId, p2Id, seed.sistema],
        );

        const resView = await tx.query(
          `SELECT stock_disponible, stock_activo FROM fsj.v_stock_droga WHERE tenant_id = $1 AND droga_id = $2`,
          [seed.tenantId, seed.drogaX],
        );

        expect(resView.rowCount).toBe(1);
        expect(Number(resView.rows[0].stock_disponible)).toBe(110);
        expect(Number(resView.rows[0].stock_activo)).toBe(11); // 10 + (100 * 1 / 100)
      });
    });
  });

  it("listStockDrogasSql and alertasBajoMinimo compare stock_activo, not stock_disponible", async (ctx) => {
    if (!migration0111Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        // Set stock_minimo to 20 g
        await tx.query(`UPDATE fsj.droga SET stock_minimo = 20 WHERE id = $1`, [seed.drogaX]);

        // Insert a 1% dilución of 100 g: stock_disponible = 100 (which is > 20), but stock_activo = 1 (which is < 20!)
        const resPartida = await tx.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
           VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 100, $4, 1) RETURNING id`,
          [seed.tenantId, seed.drogaX, `L-${randomUUID().slice(0, 8)}`, FUTURO],
        );
        const pId = resPartida.rows[0].id as string;
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_INICIAL', 100, $3)`,
          [seed.tenantId, pId, seed.sistema],
        );

        // 1. listStockDrogasSql with soloBajoMinimo
        const sql = listStockDrogasSql({
          tenantId: seed.tenantId,
          diasAlertaVencimiento: 30,
          page: 1,
          pageSize: 20,
          soloBajoMinimo: true,
        });
        const resList = await tx.query(sql.text, sql.values);
        const rows = resList.rows as ListStockDrogasRow[];
        const filaX = rows.find((r) => r.droga_id === seed.drogaX);

        expect(filaX).toBeDefined();
        expect(filaX?.bajo_minimo).toBe(true);
        expect(Number(filaX?.stock_disponible)).toBe(100);
        expect(Number(filaX?.stock_activo)).toBe(1);

        // 2. alertasBajoMinimo query: compare against stock_activo < stock_minimo
        const resAlertas = await tx.query<{ droga_id: string; stock_activo: string; stock_disponible: string }>(
          `SELECT d.id AS droga_id, coalesce(v.stock_disponible, 0)::text AS stock_disponible,
                  coalesce(v.stock_activo, 0)::text AS stock_activo
           FROM fsj.droga d
           LEFT JOIN fsj.v_stock_droga v ON v.tenant_id = d.tenant_id AND v.droga_id = d.id
           WHERE d.tenant_id = $1 AND d.fecha_baja IS NULL
             AND coalesce(v.stock_activo, 0) < d.stock_minimo`,
          [seed.tenantId],
        );
        const alertaX = resAlertas.rows.find((r) => r.droga_id === seed.drogaX);
        expect(alertaX).toBeDefined();
        expect(Number(alertaX?.stock_activo)).toBe(1);
        expect(Number(alertaX?.stock_disponible)).toBe(100);
      });
    });
  });
});
