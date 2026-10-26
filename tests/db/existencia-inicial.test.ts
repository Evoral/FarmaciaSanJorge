/**
 * DB tests for migration 0100_existencia_inicial (openspec/specs/existencia-inicial/spec.md):
 * - INV-S24 (trg_partida_validar_existencia_inicial): window open vs closed
 * - INV-S25 (partida_validar_ingreso_compra): INGRESO_INICIAL for EXISTENCIA_INICIAL, INGRESO_COMPRA for COMPRA
 * - INV-S26 (tenant_validar_relevamiento_inicial): DT vigente requirement and irreversible close
 * - uq_partida_lote_sin_proveedor: partial unique index behavior
 * - movimiento_stock_aplicar: INGRESO_INICIAL increases cantidad_disponible
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import {
  asOwner,
  inRollbackTx,
  expectInvariantViolation,
  expectDbRejection,
  setRelojPrueba,
} from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  createUserWithRole,
  designarDt,
  insertUnidad,
  insertDroga,
  insertProveedor,
  FUTURO,
} from "./fixtures";

interface SeedResult {
  tenantId: string;
  sistema: string;
  dtId: string;
  drogaId: string;
  unidadId: string;
  proveedorId: string;
}

async function seedBase(tx: Client): Promise<SeedResult> {
  const tenantId = await insertTenant(tx, "ex-ini");
  const sistema = await createSistemaUser(tx, tenantId);
  const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt");
  await designarDt(tx, tenantId, dtId, sistema);

  const unidadId = await insertUnidad(tx, "g", "MASA", 1);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const proveedorId = await insertProveedor(tx, tenantId);

  return { tenantId, sistema, dtId, drogaId, unidadId, proveedorId };
}

describe.skipIf(dbTestSkipReason() !== null)("0100_existencia_inicial DB invariants", () => {
  describe("INV-S24: trg_partida_validar_existencia_inicial", () => {
    it("allows inserting an EXISTENCIA_INICIAL partida while relevamiento inicial is open", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const lote = `LOTE-${randomUUID()}`;

          const res = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 5, $4) RETURNING id`,
            [seed.tenantId, seed.drogaId, lote, FUTURO],
          );
          const partidaId = res.rows[0].id as string;
          expect(partidaId).toBeDefined();

          await tx.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
             VALUES ($1, $2, 'INGRESO_INICIAL', 5, $3)`,
            [seed.tenantId, partidaId, seed.sistema],
          );
          await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
        });
      });
    });

    it("rejects inserting an EXISTENCIA_INICIAL partida once the relevamiento is closed by DT", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);

          // Close the relevamiento inicial
          await tx.query(
            `UPDATE fsj.tenant
             SET relevamiento_inicial_cerrado_en = now(),
                 relevamiento_inicial_cerrado_por_id = $2
             WHERE id = $1`,
            [seed.tenantId, seed.dtId],
          );

          // Attempt to insert EXISTENCIA_INICIAL partida
          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
                 VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 5, $4)`,
                [seed.tenantId, seed.drogaId, `LOTE-${randomUUID()}`, FUTURO],
              ),
            "INV-S24",
          );

          // But a standard COMPRA partida is still allowed
          const compra = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'COMPRA', $3, $4, 10, 5, $5) RETURNING id`,
            [seed.tenantId, seed.drogaId, seed.proveedorId, `LOTE-${randomUUID()}`, FUTURO],
          );
          expect(compra.rows[0].id).toBeDefined();
        });
      });
    });

    it("rejects inserting an EXISTENCIA_INICIAL partida once past relevamiento_inicial_fecha_limite", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);

          // Pin time to 2026-06-01
          await setRelojPrueba(tx, "2026-06-01T12:00:00-03:00");

          // Insert a signed cierre_diario on 2026-06-01
          const dtDesignacion = await tx.query(
            `SELECT id, matricula FROM fsj.designacion_director_tecnico WHERE tenant_id = $1 AND usuario_id = $2`,
            [seed.tenantId, seed.dtId],
          );
          await tx.query(
            `INSERT INTO fsj.cierre_diario (tenant_id, fecha, director_tecnico_id, designacion_id, matricula_dt, cantidad_asientos_recetario, cerrado_en)
             VALUES ($1, '2026-06-01', $2, $3, $4, 0, now())`,
            [seed.tenantId, seed.dtId, dtDesignacion.rows[0].id, dtDesignacion.rows[0].matricula],
          );

          // Set default dias_relevamiento_inicial to 30
          await tx.query(
            `INSERT INTO fsj.parametro (tenant_id, clave, valor) VALUES ($1, 'dias_relevamiento_inicial', '30')
             ON CONFLICT (tenant_id, clave) DO UPDATE SET valor = '30'`,
            [seed.tenantId],
          );

          // Advance jornada past 2026-06-01 + 30 days -> 2026-07-05
          await setRelojPrueba(tx, "2026-07-05T12:00:00-03:00");

          // Insertion of EXISTENCIA_INICIAL is now rejected
          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
                 VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 5, $4)`,
                [seed.tenantId, seed.drogaId, `LOTE-${randomUUID()}`, FUTURO],
              ),
            "INV-S24",
          );
        });
      });
    });
  });

  describe("INV-S25: fsj.partida_validar_ingreso_compra with INGRESO_INICIAL", () => {
    it("an EXISTENCIA_INICIAL partida requires INGRESO_INICIAL, rejecting INGRESO_COMPRA", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const lote = `LOTE-${randomUUID()}`;

          const res = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 5, $4) RETURNING id`,
            [seed.tenantId, seed.drogaId, lote, FUTURO],
          );
          const partidaId = res.rows[0].id as string;

          // Adding an INGRESO_COMPRA movement to an EXISTENCIA_INICIAL partida
          await tx.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
             VALUES ($1, $2, 'INGRESO_COMPRA', 5, $3)`,
            [seed.tenantId, partidaId, seed.sistema],
          );

          await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-S25");
        });
      });
    });

    it("an EXISTENCIA_INICIAL partida rejects an INGRESO_INICIAL with mismatched quantity", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const lote = `LOTE-${randomUUID()}`;

          const res = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 10, $4) RETURNING id`,
            [seed.tenantId, seed.drogaId, lote, FUTURO],
          );
          const partidaId = res.rows[0].id as string;

          // Quantity 8 instead of 10
          await tx.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
             VALUES ($1, $2, 'INGRESO_INICIAL', 8, $3)`,
            [seed.tenantId, partidaId, seed.sistema],
          );

          await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-S25");
        });
      });
    });

    it("a COMPRA partida rejects INGRESO_INICIAL", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const lote = `LOTE-${randomUUID()}`;

          const res = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'COMPRA', $3, $4, 10, 5, $5) RETURNING id`,
            [seed.tenantId, seed.drogaId, seed.proveedorId, lote, FUTURO],
          );
          const partidaId = res.rows[0].id as string;

          // INGRESO_INICIAL instead of INGRESO_COMPRA
          await tx.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
             VALUES ($1, $2, 'INGRESO_INICIAL', 5, $3)`,
            [seed.tenantId, partidaId, seed.sistema],
          );

          await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-S25");
        });
      });
    });
  });

  describe("INV-S26: tenant_validar_relevamiento_inicial", () => {
    it("rejects close when the user is not a DT vigente", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const farmaceuticoId = await createUserWithRole(tx, seed.tenantId, "FARMACEUTICO", seed.sistema, "farm");

          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `UPDATE fsj.tenant
                 SET relevamiento_inicial_cerrado_en = now(),
                     relevamiento_inicial_cerrado_por_id = $2
                 WHERE id = $1`,
                [seed.tenantId, farmaceuticoId],
              ),
            "INV-S26",
          );
        });
      });
    });

    it("enforces tenant_relevamiento_inicial_cierre_completo (both fields set or both null)", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);

          // Only setting date without user violates CHECK constraint 23514
          await expectDbRejection(
            tx,
            () =>
              tx.query(
                `UPDATE fsj.tenant
                 SET relevamiento_inicial_cerrado_en = now(),
                     relevamiento_inicial_cerrado_por_id = NULL
                 WHERE id = $1`,
                [seed.tenantId],
              ),
            "23514",
          );
        });
      });
    });

    it("prevents reopening or modifying close once closed (never reopens)", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);

          // Close cleanly
          await tx.query(
            `UPDATE fsj.tenant
             SET relevamiento_inicial_cerrado_en = now(),
                 relevamiento_inicial_cerrado_por_id = $2
             WHERE id = $1`,
            [seed.tenantId, seed.dtId],
          );

          // Attempt to reopen by setting to NULL
          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `UPDATE fsj.tenant
                 SET relevamiento_inicial_cerrado_en = NULL,
                     relevamiento_inicial_cerrado_por_id = NULL
                 WHERE id = $1`,
                [seed.tenantId],
              ),
            "INV-S26",
          );

          // Attempt to re-close with a different timestamp
          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `UPDATE fsj.tenant
                 SET relevamiento_inicial_cerrado_en = now() + interval '1 day',
                     relevamiento_inicial_cerrado_por_id = $2
                 WHERE id = $1`,
                [seed.tenantId, seed.dtId],
              ),
            "INV-S26",
          );
        });
      });
    });
  });

  describe("uq_partida_lote_sin_proveedor", () => {
    it("rejects duplicate (tenant, droga, lote) when proveedor_id IS NULL", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const lote = "LOTE-DUPLICADO";

          // First insert with proveedor_id IS NULL
          await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 5, $4)`,
            [seed.tenantId, seed.drogaId, lote, FUTURO],
          );

          // Second insert with same lote and proveedor_id IS NULL -> violates unique index 23505
          await expectDbRejection(
            tx,
            () =>
              tx.query(
                `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
                 VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 5, $4)`,
                [seed.tenantId, seed.drogaId, lote, FUTURO],
              ),
            "23505",
          );
        });
      });
    });

    it("allows the same lote when one row has proveedor_id IS NULL and another has a proveedor", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const lote = "LOTE-COMPARTIDO";

          // Row without proveedor
          const r1 = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 5, $4) RETURNING id`,
            [seed.tenantId, seed.drogaId, lote, FUTURO],
          );
          expect(r1.rows[0].id).toBeDefined();

          // Row with proveedor
          const r2 = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'COMPRA', $3, $4, 10, 5, $5) RETURNING id`,
            [seed.tenantId, seed.drogaId, seed.proveedorId, lote, FUTURO],
          );
          expect(r2.rows[0].id).toBeDefined();
        });
      });
    });
  });

  describe("movimiento_stock_aplicar: INGRESO_INICIAL increments cantidad_disponible", () => {
    it("increases cantidad_disponible by the exact movement quantity on INGRESO_INICIAL", async () => {
      await asOwner(async (tx) => {
        await inRollbackTx(tx, async () => {
          const seed = await seedBase(tx);
          const lote = `LOTE-${randomUUID()}`;

          // Insert partida (cantidad_disponible defaults to 0)
          const res = await tx.query(
            `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
             VALUES ($1, $2, 'EXISTENCIA_INICIAL', NULL, $3, 10, 35.5, $4) RETURNING id`,
            [seed.tenantId, seed.drogaId, lote, FUTURO],
          );
          const partidaId = res.rows[0].id as string;

          // Before movement: 0
          const antes = await tx.query(`SELECT cantidad_disponible FROM fsj.partida WHERE id = $1`, [partidaId]);
          expect(Number(antes.rows[0].cantidad_disponible)).toBe(0);

          // Insert INGRESO_INICIAL
          await tx.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
             VALUES ($1, $2, 'INGRESO_INICIAL', 35.5, $3)`,
            [seed.tenantId, partidaId, seed.sistema],
          );

          // After movement: 35.5
          const despues = await tx.query(`SELECT cantidad_disponible FROM fsj.partida WHERE id = $1`, [partidaId]);
          expect(Number(despues.rows[0].cantidad_disponible)).toBe(35.5);
        });
      });
    });
  });
});
