/**
 * DB tests for prisma/migrations/.../0016_entrega_archivo (M14/M15). See
 * tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/fixtures.ts for the shared seed helpers.
 */
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection } from "./helpers";
import { insertTenant, createSistemaUser, insertPaciente, insertMedico, insertReceta, insertItemReceta, insertComponente, insertUnidad, insertDroga } from "./fixtures";

/** Steps a receta through PENDIENTE_PREPARACION -> ... -> LISTA_PARA_RETIRAR, with receta_fisica_recibida set. Stops one step before ENTREGADA so callers can exercise the entrega itself. */
async function avanzarHastaListaParaRetirar(tx: Client, tenantId: string, recetaId: string, sistema: string): Promise<void> {
  await tx.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  await tx.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  await tx.query(
    `UPDATE fsj.receta SET estado = 'LISTA_PARA_RETIRAR', receta_fisica_recibida = true, receta_fisica_recibida_en = now(), receta_fisica_recibida_por_id = $3
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, recetaId, sistema],
  );
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

async function insertLoteArchivo(tx: Client, tenantId: string, sistema: string): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.lote_archivo_recetas (tenant_id, periodo_desde, periodo_hasta, ubicacion, registrado_por_id)
     VALUES ($1, '2024-01-01', '2024-01-31', 'Deposito A', $2) RETURNING id`,
    [tenantId, sistema],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0016_entrega_archivo migration (fsj schema)", () => {
  it("INV-R07: a RETIRO_PRESENCIAL entrega requires receta_fisica_recibida (defense in depth)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "r07");
        // Force receta_fisica_recibida back to false via a fresh receta that
        // never went through avanzarHastaListaParaRetirar (stays PENDIENTE_PREPARACION).
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3)`,
              [tenantId, recetaId, sistema],
            ),
          "INV-R07",
        );
      }),
    );
  });

  it("entrega succeeds once receta_fisica_recibida is true, is UNIQUE per receta, and firma_recibida cannot revert to false", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "entregaOk");
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId, sistema);

        const entrega = await tx.query(
          `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3) RETURNING id`,
          [tenantId, recetaId, sistema],
        );
        expect(entrega.rows[0].id).toBeTruthy();

        await expectDbRejection(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3)`, [
              tenantId,
              recetaId,
              sistema,
            ]),
          "23505",
        );

        await tx.query(`UPDATE fsj.entrega SET firma_recibida = true, firma_recibida_en = now() WHERE id = $1`, [entrega.rows[0].id]);
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.entrega SET firma_recibida = false, firma_recibida_en = NULL WHERE id = $1`, [entrega.rows[0].id]),
          "INV-ENT-001",
        );
      }),
    );
  });

  it("an ENVIO entrega does not require receta_fisica_recibida up front (INV-R07 only gates RETIRO_PRESENCIAL)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "envio");
        const entrega = await tx.query(
          `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3) RETURNING id`,
          [tenantId, recetaId, sistema],
        );
        expect(entrega.rows[0].id).toBeTruthy();
      }),
    );
  });

  it("lote_archivo_recetas: linear state machine EN_ARCHIVO -> PLAZO_CUMPLIDO -> DESTRUCCION_SOLICITADA -> DESTRUCCION_AUTORIZADA -> DESTRUIDO, no skipping", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "loteEstados");
        const sistema = await createSistemaUser(tx, tenantId);
        const loteId = await insertLoteArchivo(tx, tenantId, sistema);

        // Skipping straight to DESTRUCCION_SOLICITADA is rejected.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.lote_archivo_recetas SET estado = 'DESTRUCCION_SOLICITADA' WHERE id = $1`, [loteId]),
          "INV-ARC-005",
        );

        await tx.query(`UPDATE fsj.lote_archivo_recetas SET estado = 'PLAZO_CUMPLIDO' WHERE id = $1`, [loteId]);
        await tx.query(`UPDATE fsj.lote_archivo_recetas SET estado = 'DESTRUCCION_SOLICITADA' WHERE id = $1`, [loteId]);
        await tx.query(`UPDATE fsj.lote_archivo_recetas SET estado = 'DESTRUCCION_AUTORIZADA' WHERE id = $1`, [loteId]);

        // INV-D02: DESTRUIDO requires expediente_autorizacion + fecha_autorizacion.
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.lote_archivo_recetas SET estado = 'DESTRUIDO' WHERE id = $1`, [loteId]),
          "23514",
        );

        await tx.query(
          `UPDATE fsj.lote_archivo_recetas SET estado = 'DESTRUIDO', expediente_autorizacion = 'EXP-1', fecha_autorizacion = current_date, fecha_destruccion = current_date WHERE id = $1`,
          [loteId],
        );

        // INV-D05: DESTRUIDO is terminal -- absolutely nothing changes again.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.lote_archivo_recetas SET ubicacion = 'Otro deposito' WHERE id = $1`, [loteId]),
          "INV-D05",
        );
      }),
    );
  });

  it("INV-ARC-006: receta.lote_archivo_id can only be set when ENTREGADA/ANULADA and receta_fisica_recibida, and is frozen once set", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "arc006");
        const loteId = await insertLoteArchivo(tx, tenantId, sistema);

        // Still PENDIENTE_PREPARACION -- rejected.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET lote_archivo_id = $1 WHERE id = $2`, [loteId, recetaId]),
          "INV-ARC-006",
        );

        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId, sistema);
        // migration 0040's INV-ENT-002 now requires a matching entrega row
        // before estado can become ENTREGADA -- insert one (RETIRO_PRESENCIAL)
        // first, same as the "entregaOk" test above.
        await tx.query(
          `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3)`,
          [tenantId, recetaId, sistema],
        );
        await tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);

        await tx.query(`UPDATE fsj.receta SET lote_archivo_id = $1 WHERE id = $2`, [loteId, recetaId]);
        const check = await tx.query(`SELECT lote_archivo_id FROM fsj.receta WHERE id = $1`, [recetaId]);
        expect(check.rows[0].lote_archivo_id).toBe(loteId);

        const otroLote = await insertLoteArchivo(tx, tenantId, sistema);
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET lote_archivo_id = $1 WHERE id = $2`, [otroLote, recetaId]),
          "INV-ARC-006",
        );
      }),
    );
  });

  it("fsj_app has no DELETE grant on entrega/lote_archivo_recetas", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedReceta(tx, "nodelete");
        await avanzarHastaListaParaRetirar(tx, tenantId, recetaId, sistema);
        const entrega = await tx.query(
          `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3) RETURNING id`,
          [tenantId, recetaId, sistema],
        );
        const loteId = await insertLoteArchivo(tx, tenantId, sistema);

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.entrega WHERE id = $1`, [entrega.rows[0].id]), "42501");
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.lote_archivo_recetas WHERE id = $1`, [loteId]), "42501");
      }),
    );
  });
});
