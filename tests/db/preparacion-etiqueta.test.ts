/**
 * DB tests for prisma/migrations/.../0013_preparacion_etiqueta
 * (FASE 1 point 1.11). See tests/db/helpers.ts for the rollback-transaction
 * safety model and tests/db/fixtures.ts for the shared seed helpers.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import {
  FUTURO,
  insertTenant,
  createSistemaUser,
  insertUnidad,
  insertDroga,
  insertMedico,
  insertPaciente,
  insertReceta,
  insertItemReceta,
  insertComponente,
  insertFicha,
  insertLinea,
} from "./fixtures";

async function seedFicha(tx: Client, suffix: string) {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId });
  const fichaTecnicaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
  const lineaPesajeId = await insertLinea(tx, { tenantId, fichaTecnicaId, drogaId, unidadMedidaId: unidadId });

  return { tenantId, sistema, unidadId, drogaId, itemRecetaId, fichaTecnicaId, lineaPesajeId };
}

async function insertPreparacion(
  tx: Client,
  input: { tenantId: string; fichaTecnicaId: string; iniciadaPorId: string },
): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [input.tenantId, input.fichaTecnicaId, input.iniciadaPorId],
  );
  return result.rows[0].id as string;
}

async function insertProveedor(tx: Client, tenantId: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'Prov', $2) RETURNING id`, [
    tenantId,
    `2${Math.floor(10000000000 + Math.random() * 8999999999)}`.slice(0, 11),
  ]);
  return result.rows[0].id as string;
}

async function crearPartidaConIngreso(
  tx: Client,
  input: { tenantId: string; drogaId: string; proveedorId: string; registradoPorId: string },
): Promise<string> {
  const partida = await tx.query(
    `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
     VALUES ($1, $2, $3, $4, 10, 100, $5) RETURNING id`,
    [input.tenantId, input.drogaId, input.proveedorId, `LOTE-${Date.now()}-${Math.random()}`, FUTURO],
  );
  const partidaId = partida.rows[0].id as string;
  await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id) VALUES ($1, $2, 'INGRESO_COMPRA', 100, $3)`,
    [input.tenantId, partidaId, input.registradoPorId],
  );
  return partidaId;
}

describe.skipIf(dbTestSkipReason() !== null)("0013_preparacion_etiqueta migration (fsj schema)", () => {
  it("INV-P01: preparacion requires a ficha_tecnica (NOT NULL FK) and freezes item_receta_id from it", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, itemRecetaId, fichaTecnicaId } = await seedFicha(tx, "p01");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });

        const result = await tx.query(`SELECT item_receta_id FROM fsj.preparacion WHERE id = $1`, [preparacionId]);
        expect(result.rows[0].item_receta_id).toBe(itemRecetaId);

        // ficha_tecnica_id = NULL is caught by the BEFORE INSERT trigger
        // (fsj.preparacion_set_item_receta_id) before the column's own NOT
        // NULL constraint would even run -- it raises INV-P01 itself.
        await expectInvariantViolation(
          tx,
          () => tx.query(`INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, NULL, $2)`, [
            tenantId,
            sistema,
          ]),
          "INV-P01",
        );
      }),
    );
  });

  it("preparacion.item_receta_id and ficha_tecnica_id are frozen after insert (cannot be changed)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "frozen");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });
        const otro = await seedFicha(tx, "frozenOtro");

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.preparacion SET ficha_tecnica_id = $1 WHERE id = $2`, [otro.fichaTecnicaId, preparacionId]),
          "INV-P01",
        );
      }),
    );
  });

  it("INV-P02: at most one non-DESCARTADA preparacion per ficha_tecnica (partial unique index)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "p02");
        await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });

        await expectDbRejection(
          tx,
          () => insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema }),
          "23505",
        );
      }),
    );
  });

  it("INV-P02: a NEW preparacion for the same ficha_tecnica IS allowed once the previous one is DESCARTADA", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "p02b");
        const first = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });
        await tx.query(
          `UPDATE fsj.preparacion SET estado = 'DESCARTADA', motivo_descarte = 'error', descartada_por_id = $1, descartada_en = now() WHERE id = $2`,
          [sistema, first],
        );

        const second = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });
        expect(second).toBeTruthy();
      }),
    );
  });

  it("INV-PRP-003: at most one CONFIRMADA preparacion per item_receta, even across two fichas (versions) of the same item", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, itemRecetaId, fichaTecnicaId } = await seedFicha(tx, "prp003");
        const fichaV2 = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema, version: 2 });
        // linea_pesaje required for fichaV2 to satisfy INV-R03 by commit --
        // reuse the same droga/unidad the fixture already seeded a linea for.
        const drogaResult = await tx.query(`SELECT droga_id, unidad_medida_id FROM fsj.linea_pesaje WHERE ficha_tecnica_id = $1`, [
          fichaTecnicaId,
        ]);
        await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaV2,
          drogaId: drogaResult.rows[0].droga_id,
          unidadMedidaId: drogaResult.rows[0].unidad_medida_id,
        });

        const prep1 = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });
        await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
          sistema,
          prep1,
        ]);

        // A second preparacion, on the OTHER ficha (fichaV2) of the SAME item_receta.
        const prep2 = await insertPreparacion(tx, { tenantId, fichaTecnicaId: fichaV2, iniciadaPorId: sistema });

        await expectDbRejection(
          tx,
          () =>
            tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
              sistema,
              prep2,
            ]),
          "23505",
        );
      }),
    );
  });

  it("INV-P05 / state machine: INICIADA -> CONFIRMADA requires confirmada_en + preparada_por_id (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "p05confirm");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });

        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA' WHERE id = $1`, [preparacionId]),
          "23514",
        );

        await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
          sistema,
          preparacionId,
        ]);
        const result = await tx.query(`SELECT estado FROM fsj.preparacion WHERE id = $1`, [preparacionId]);
        expect(result.rows[0].estado).toBe("CONFIRMADA");
      }),
    );
  });

  it("INV-P05: CONFIRMADA never changes state again (terminal)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "p05terminal");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });
        await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
          sistema,
          preparacionId,
        ]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `UPDATE fsj.preparacion SET estado = 'DESCARTADA', motivo_descarte = 'x', descartada_por_id = $1, descartada_en = now() WHERE id = $2`,
              [sistema, preparacionId],
            ),
          "INV-P05",
        );
      }),
    );
  });

  it("INV-P05: DESCARTADA requires motivo_descarte + descartada_por_id + descartada_en (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "p05descarte");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });

        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.preparacion SET estado = 'DESCARTADA' WHERE id = $1`, [preparacionId]),
          "23514",
        );

        await tx.query(
          `UPDATE fsj.preparacion SET estado = 'DESCARTADA', motivo_descarte = 'error de carga', descartada_por_id = $1, descartada_en = now() WHERE id = $2`,
          [sistema, preparacionId],
        );
        const result = await tx.query(`SELECT estado FROM fsj.preparacion WHERE id = $1`, [preparacionId]);
        expect(result.rows[0].estado).toBe("DESCARTADA");
      }),
    );
  });

  it("etiqueta: can only be generated for a CONFIRMADA preparacion (defense-in-depth trigger)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "etq");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.etiqueta (tenant_id, preparacion_id, contenido) VALUES ($1, $2, 'x')`, [
              tenantId,
              preparacionId,
            ]),
          "INV-ETQ-001",
        );

        await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
          sistema,
          preparacionId,
        ]);

        const etiqueta = await tx.query(`INSERT INTO fsj.etiqueta (tenant_id, preparacion_id, contenido) VALUES ($1, $2, 'x') RETURNING id`, [
          tenantId,
          preparacionId,
        ]);
        expect(etiqueta.rows[0].id).toBeTruthy();
      }),
    );
  });

  it("etiqueta: preparacion_id is UNIQUE (at most one etiqueta per preparacion)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "etqunica");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });
        await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
          sistema,
          preparacionId,
        ]);
        await tx.query(`INSERT INTO fsj.etiqueta (tenant_id, preparacion_id, contenido) VALUES ($1, $2, 'x')`, [
          tenantId,
          preparacionId,
        ]);

        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.etiqueta (tenant_id, preparacion_id, contenido) VALUES ($1, $2, 'y')`, [tenantId, preparacionId]),
          "23505",
        );
      }),
    );
  });

  it("movimiento_stock.preparacion_id FK: an EGRESO_PREPARACION referencing a nonexistent preparacion is rejected (23503)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, drogaId, lineaPesajeId } = await seedFicha(tx, "fkmov");
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema });

        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
               VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, $5)`,
              [tenantId, partidaId, "00000000-0000-0000-0000-000000000000", lineaPesajeId, sistema],
            ),
          "23503",
        );
      }),
    );
  });

  it("movimiento_stock.preparacion_id FK: an EGRESO_PREPARACION referencing a REAL preparacion succeeds", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, drogaId, fichaTecnicaId, lineaPesajeId } = await seedFicha(tx, "fkmovok");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema });

        const result = await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, $5) RETURNING id`,
          [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
        );
        expect(result.rows[0].id).toBeTruthy();
      }),
    );
  });

  it("movimiento_stock.preparacion_id FK is tenant-scoped: cannot reference a preparacion from another tenant (INV-T02)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await seedFicha(tx, "fkcrossA");
        const preparacionA = await insertPreparacion(tx, { tenantId: a.tenantId, fichaTecnicaId: a.fichaTecnicaId, iniciadaPorId: a.sistema });

        const b = await seedFicha(tx, "fkcrossB");
        const proveedorB = await insertProveedor(tx, b.tenantId);
        const partidaB = await crearPartidaConIngreso(tx, {
          tenantId: b.tenantId,
          drogaId: b.drogaId,
          proveedorId: proveedorB,
          registradoPorId: b.sistema,
        });

        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
               VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, $5)`,
              [b.tenantId, partidaB, preparacionA, b.lineaPesajeId, b.sistema],
            ),
          "23503",
        );
      }),
    );
  });

  it("cross-tenant isolation: tenant B never sees tenant A's preparacion/etiqueta (INV-T01/T02)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await seedFicha(tx, "isoA");
        const preparacionId = await insertPreparacion(tx, { tenantId: a.tenantId, fichaTecnicaId: a.fichaTecnicaId, iniciadaPorId: a.sistema });
        await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
          a.sistema,
          preparacionId,
        ]);
        const etiqueta = await tx.query(`INSERT INTO fsj.etiqueta (tenant_id, preparacion_id, contenido) VALUES ($1, $2, 'x') RETURNING id`, [
          a.tenantId,
          preparacionId,
        ]);

        const tenantB = await insertTenant(tx, "isoB");

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantB, async (scoped) => {
          const preps = await scoped.query(`SELECT id FROM fsj.preparacion WHERE id = $1`, [preparacionId]);
          expect(preps.rows).toHaveLength(0);
          const etiquetas = await scoped.query(`SELECT id FROM fsj.etiqueta WHERE id = $1`, [etiqueta.rows[0].id]);
          expect(etiquetas.rows).toHaveLength(0);
        });
      }),
    );
  });

  it("no DELETE grant on preparacion/etiqueta for fsj_app", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, fichaTecnicaId } = await seedFicha(tx, "nodelete");
        const preparacionId = await insertPreparacion(tx, { tenantId, fichaTecnicaId, iniciadaPorId: sistema });

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.preparacion WHERE id = $1`, [preparacionId]), "42501");
      }),
    );
  });
});
