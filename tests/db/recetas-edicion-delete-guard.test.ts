/**
 * DB tests for migration 0030 (INV-R11, FASE 6 point 6.3): item_receta and
 * componente_item_receta now have a GRANT DELETE for fsj_app, guarded by a
 * BEFORE DELETE trigger that only allows it while the receta is
 * PENDIENTE_PREPARACION AND none of its items has a ficha_tecnica with a
 * preparacion. Everything NOT specific to this new guard (V1/V2/V3/INV-R01
 * deferred constraint triggers, the state machine, etc.) is already covered
 * by tests/db/recetas-items-componentes.test.ts -- read there first, not
 * duplicated here.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection } from "./helpers";
import {
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
} from "./fixtures";

async function insertPreparacion(tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }> }, tenantId: string, fichaTecnicaId: string, iniciadaPorId: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`, [
    tenantId,
    fichaTecnicaId,
    iniciadaPorId,
  ]);
  return result.rows[0]!.id;
}

describe.skipIf(dbTestSkipReason() !== null)("0030_receta_edicion_delete_guard migration (fsj schema)", () => {
  it("INV-R11: fsj_app CAN delete a componente_item_receta while the receta is PENDIENTE_PREPARACION and has no ficha con preparacion", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "delok1");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "delok1");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });
        const componenteBId = await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 1 });

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await tx.query(`DELETE FROM fsj.componente_item_receta WHERE id = $1`, [componenteBId]);

        const remaining = await tx.query(`SELECT id FROM fsj.componente_item_receta WHERE item_receta_id = $1`, [itemRecetaId]);
        expect(remaining.rows).toHaveLength(1);
      }),
    );
  });

  it("INV-R11: fsj_app CANNOT delete a componente_item_receta once the receta left PENDIENTE_PREPARACION", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "delbad1");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "delbad1");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });
        const componenteBId = await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 1 });

        await tx.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE id = $1`, [recetaId]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.componente_item_receta WHERE id = $1`, [componenteBId]),
          "INV-R11",
        );
      }),
    );
  });

  it("INV-R11: fsj_app CANNOT delete a componente_item_receta once one of the receta's items has a ficha_tecnica with a preparacion (estado still PENDIENTE_PREPARACION)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "delbad2");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "delbad2");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });
        const componenteBId = await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 1 });

        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
        await insertPreparacion(tx, tenantId, fichaId, sistema);

        const recetaEstado = await tx.query(`SELECT estado FROM fsj.receta WHERE id = $1`, [recetaId]);
        expect(recetaEstado.rows[0]!.estado).toBe("PENDIENTE_PREPARACION");

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.componente_item_receta WHERE id = $1`, [componenteBId]),
          "INV-R11",
        );
      }),
    );
  });

  it("INV-R11: fsj_app CAN delete an item_receta (with its componentes already removed) while editable, leaving the receta with >= 1 item (INV-R01 still holds)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "delok2");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "delok2");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemAId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId: itemAId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });
        const itemBId = await insertItemReceta(tx, { tenantId, recetaId });
        const componenteBId = await insertComponente(tx, { tenantId, itemRecetaId: itemBId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        // FK order: componentes of the item first, then the item itself.
        await tx.query(`DELETE FROM fsj.componente_item_receta WHERE id = $1`, [componenteBId]);
        await tx.query(`DELETE FROM fsj.item_receta WHERE id = $1`, [itemBId]);

        const remaining = await tx.query(`SELECT id FROM fsj.item_receta WHERE receta_id = $1`, [recetaId]);
        expect(remaining.rows).toHaveLength(1);
        expect(remaining.rows[0]!.id).toBe(itemAId);
      }),
    );
  });

  it("INV-R11: fsj_app CANNOT delete an item_receta once the receta left PENDIENTE_PREPARACION", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "delbad3");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "delbad3");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemAId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId: itemAId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });
        const itemBId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId: itemBId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });

        await tx.query(`UPDATE fsj.receta SET estado = 'ANULADA', motivo_anulacion = 'x' WHERE id = $1`, [recetaId]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.item_receta WHERE id = $1`, [itemBId]), "INV-R11");
      }),
    );
  });

  it("fsj_app has no UPDATE/DELETE-adjacent surprise grant: DELETE on fsj.receta itself is still rejected (unchanged by this migration -- see tests/db/recetas-items-componentes.test.ts)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "delreceta");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.receta WHERE id = $1`, [recetaId]), "42501");
      }),
    );
  });
});
