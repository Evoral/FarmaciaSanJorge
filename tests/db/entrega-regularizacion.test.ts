/**
 * DB tests for prisma/migrations/.../0040_entrega_regularizacion (M14,
 * FASE 11). See tests/db/helpers.ts for the rollback-transaction safety
 * model and tests/db/fixtures.ts for the shared seed helpers. NOT RUN by
 * this task (hard rule) -- written to the same conventions as
 * tests/db/entrega-archivo.test.ts.
 */
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation } from "./helpers";
import { insertTenant, createSistemaUser, insertPaciente, insertMedico, insertReceta, insertItemReceta, insertComponente, insertUnidad, insertDroga } from "./fixtures";

/** Steps a receta through PENDIENTE_PREPARACION -> ... -> LISTA_PARA_RETIRAR -- same helper as tests/db/entrega-archivo.test.ts (own copy, test files do not import from each other). */
async function avanzarHastaListaParaRetirar(tx: Client, tenantId: string, recetaId: string, sistema: string): Promise<void> {
  await tx.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  await tx.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  await tx.query(
    `UPDATE fsj.receta SET estado = 'LISTA_PARA_RETIRAR', receta_fisica_recibida = true, receta_fisica_recibida_en = now(), receta_fisica_recibida_por_id = $3
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, recetaId, sistema],
  );
}

/** Same shape as tests/db/entrega-archivo.test.ts's own copy -- leaves receta_fisica_recibida false (unlike avanzarHastaListaParaRetirar) so the ENVIO path can be exercised. */
async function avanzarHastaListaParaRetirarSinFisica(tx: Client, tenantId: string, recetaId: string): Promise<void> {
  await tx.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  await tx.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  await tx.query(`UPDATE fsj.receta SET estado = 'LISTA_PARA_RETIRAR' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
}

async function seedReceta(tx: Client, suffix: string): Promise<{ tenantId: string; sistema: string; recetaId: string }> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId });
  return { tenantId, sistema, recetaId };
}

describe.skipIf(dbTestSkipReason() !== null)("0040_entrega_regularizacion migration (fsj schema)", () => {
  it("INV-ENT-002: receta.estado cannot become ENTREGADA without a matching entrega row", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "ent002-sin");
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId, sistema);

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]),
          "INV-ENT-002",
        );
      }),
    );
  });

  it("INV-ENT-002: succeeds once a RETIRO_PRESENCIAL entrega row exists", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "ent002-ok");
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId, sistema);

        await tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3)`, [
          tenantId,
          recetaId,
          sistema,
        ]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        const check = await tx.query(`SELECT estado FROM fsj.receta WHERE id = $1`, [recetaId]);
        expect(check.rows[0].estado).toBe("ENTREGADA");
      }),
    );
  });

  it("INV-ENT-002: an ENVIO entrega with firma_recibida still false is NOT enough for ENTREGADA", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "ent002-envio-sin-firma");
        await avanzarHastaListaParaRetirarSinFisica(tx, tenantId, recetaId);

        await tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3)`, [tenantId, recetaId, sistema]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENVIADA_PEND_FIRMA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA', receta_fisica_recibida = true WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]),
          "INV-ENT-002",
        );
      }),
    );
  });

  it("INV-ENT-003: a standalone recepcion fisica (receta_fisica_recibida only) is rejected while ENVIADA_PEND_FIRMA", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "ent003-standalone");
        await avanzarHastaListaParaRetirarSinFisica(tx, tenantId, recetaId);
        await tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3)`, [tenantId, recetaId, sistema]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENVIADA_PEND_FIRMA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`UPDATE fsj.receta SET receta_fisica_recibida = true, receta_fisica_recibida_en = now(), receta_fisica_recibida_por_id = $3 WHERE tenant_id = $1 AND id = $2`, [
              tenantId,
              recetaId,
              sistema,
            ]),
          "INV-ENT-003",
        );
      }),
    );
  });

  it("INV-ENT-003: receta_fisica_recibida combined with a non-ENTREGADA estado change is rejected while ENVIADA_PEND_FIRMA (0041)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "ent003-anulada");
        await avanzarHastaListaParaRetirarSinFisica(tx, tenantId, recetaId);
        await tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3)`, [tenantId, recetaId, sistema]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENVIADA_PEND_FIRMA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `UPDATE fsj.receta SET receta_fisica_recibida = true, receta_fisica_recibida_en = now(), receta_fisica_recibida_por_id = $3, estado = 'ANULADA', motivo_anulacion = 'prueba'
               WHERE tenant_id = $1 AND id = $2`,
              [tenantId, recetaId, sistema],
            ),
          "INV-ENT-003",
        );
      }),
    );
  });

  it("INV-ENT-003: the ATOMIC confirmar-firma path (receta_fisica_recibida + estado in ONE statement) is allowed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "ent003-atomic");
        await avanzarHastaListaParaRetirarSinFisica(tx, tenantId, recetaId);
        const entrega = await tx.query(
          `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3) RETURNING id`,
          [tenantId, recetaId, sistema],
        );
        await tx.query(`UPDATE fsj.receta SET estado = 'ENVIADA_PEND_FIRMA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        // Same write order the application uses (modules/entregas/infrastructure/entrega-repository.ts#confirmarFirmaYEntregar): entrega first.
        await tx.query(`UPDATE fsj.entrega SET firma_recibida = true, firma_recibida_en = now() WHERE id = $1`, [entrega.rows[0].id]);
        await tx.query(
          `UPDATE fsj.receta SET receta_fisica_recibida = true, receta_fisica_recibida_en = now(), receta_fisica_recibida_por_id = $3, estado = 'ENTREGADA'
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, recetaId, sistema],
        );

        const check = await tx.query(`SELECT estado, receta_fisica_recibida FROM fsj.receta WHERE id = $1`, [recetaId]);
        expect(check.rows[0].estado).toBe("ENTREGADA");
        expect(check.rows[0].receta_fisica_recibida).toBe(true);
      }),
    );
  });

  it("plazo_regularizacion_dias: readable per-tenant parametro row (seeded by scripts/create-tenant.ts / migration 0040's backfill)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "regu-param");
        // insertTenant (test fixture) bypasses scripts/create-tenant.ts's
        // parametro seeding -- insert it explicitly here, same shape the
        // script/migration use, to prove the table accepts it.
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'plazo_regularizacion_dias', 'NUMERO', '7')`,
          [tenantId],
        );
        const row = await tx.query(`SELECT valor FROM fsj.parametro WHERE tenant_id = $1 AND clave = 'plazo_regularizacion_dias'`, [tenantId]);
        expect(row.rows[0].valor).toBe("7");
      }),
    );
  });
});
