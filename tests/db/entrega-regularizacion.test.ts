/**
 * DB tests for prisma/migrations/.../0040_entrega_regularizacion (M14,
 * FASE 11). See tests/db/helpers.ts for the rollback-transaction safety
 * model and tests/db/fixtures.ts for the shared seed helpers. NOT RUN by
 * this task (hard rule) -- written to the same conventions as
 * tests/db/entrega-archivo.test.ts.
 *
 * Only INV-ENT-002 is left: migration 0051 (client decision 2026-10-01,
 * the receta física attribute was removed) dropped INV-ENT-003 and the
 * `plazo_regularizacion_dias` parametro.
 */
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation } from "./helpers";
import { insertTenant, createSistemaUser, insertPaciente, insertMedico, insertReceta, insertItemReceta, insertComponente, insertUnidad, insertDroga } from "./fixtures";

/** Steps a receta through PENDIENTE_PREPARACION -> ... -> LISTA_PARA_RETIRAR -- same helper as tests/db/entrega-archivo.test.ts (own copy, test files do not import from each other). */
async function avanzarHastaListaParaRetirar(tx: Client, tenantId: string, recetaId: string): Promise<void> {
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
        const { tenantId, recetaId } = await seedReceta(tx, "ent002-sin");
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId);

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
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId);

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
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId);

        await tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3)`, [tenantId, recetaId, sistema]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENVIADA_PEND_FIRMA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]),
          "INV-ENT-002",
        );
      }),
    );
  });

  it("INV-ENT-002: the confirmar-firma path (entrega firma_recibida first, then estado = ENTREGADA) is allowed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "ent002-firma");
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId);
        const entrega = await tx.query(
          `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3) RETURNING id`,
          [tenantId, recetaId, sistema],
        );
        await tx.query(`UPDATE fsj.receta SET estado = 'ENVIADA_PEND_FIRMA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        // Same write order the application uses (modules/entregas/infrastructure/entrega-repository.ts#confirmarFirmaYEntregar): entrega first.
        await tx.query(`UPDATE fsj.entrega SET firma_recibida = true, firma_recibida_en = now() WHERE id = $1`, [entrega.rows[0].id]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        const check = await tx.query(`SELECT estado FROM fsj.receta WHERE id = $1`, [recetaId]);
        expect(check.rows[0].estado).toBe("ENTREGADA");
      }),
    );
  });
});
