/**
 * DB tests for prisma/migrations/.../0093_repartidores_envio (openspec/specs/envios-repartidores/spec.md): the CHECK that only
 * an ENVIO carries a repartidor, INV-ENT-005 (an ENVIO needs one, and it can be changed but never removed) and the
 * composite FK that keeps the repartidor in the entrega's tenant. See tests/db/helpers.ts for the rollback-transaction
 * safety model and tests/db/fixtures.ts for the shared seed helpers. NOT RUN by the task that wrote them (the DB is
 * shared) -- written to the same conventions as tests/db/entrega-archivo.test.ts.
 *
 * Not covered here: the "pre-0093 envio with NULL repartidor stays updatable" case (E7). It needs a NULL row, which
 * only exists by disabling the trigger (ALTER TABLE ... DISABLE TRIGGER takes an ACCESS EXCLUSIVE lock on the shared
 * fsj.entrega); the trigger being `UPDATE OF repartidor_id` is what guarantees it.
 */
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection } from "./helpers";
import { insertTenant, createSistemaUser, insertPaciente, insertMedico, insertReceta, insertItemReceta, insertComponente, insertUnidad, insertDroga, insertRepartidor } from "./fixtures";

/** A PREPARADA receta of a fresh tenant: the state an entrega is registered from. */
async function seedPreparada(tx: Client, suffix: string): Promise<{ tenantId: string; sistema: string; recetaId: string }> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId });
  await tx.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  await tx.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE tenant_id = $1 AND id = $2`, [tenantId, recetaId]);
  return { tenantId, sistema, recetaId };
}

describe.skipIf(dbTestSkipReason() !== null)("0093_repartidores_envio migration (fsj schema)", () => {
  it("INV-ENT-005: an ENVIO entrega cannot be inserted without a repartidor", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedPreparada(tx, "ent005-sin");

        await expectInvariantViolation(
          tx,
          () => tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id) VALUES ($1, $2, 'ENVIO', $3)`, [tenantId, recetaId, sistema]),
          "INV-ENT-005",
        );
      }),
    );
  });

  it("INV-ENT-005: an ENVIO entrega with a repartidor is accepted, and its repartidor can be changed but not removed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedPreparada(tx, "ent005-cambio");
        const primero = await insertRepartidor(tx, tenantId, sistema);
        const segundo = await insertRepartidor(tx, tenantId, sistema);

        const entrega = await tx.query(
          `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id, repartidor_id) VALUES ($1, $2, 'ENVIO', $3, $4) RETURNING id`,
          [tenantId, recetaId, sistema, primero],
        );
        const entregaId = entrega.rows[0].id as string;

        await tx.query(`UPDATE fsj.entrega SET repartidor_id = $1 WHERE id = $2`, [segundo, entregaId]);
        const cambiado = await tx.query(`SELECT repartidor_id FROM fsj.entrega WHERE id = $1`, [entregaId]);
        expect(cambiado.rows[0].repartidor_id).toBe(segundo);

        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.entrega SET repartidor_id = NULL WHERE id = $1`, [entregaId]), "INV-ENT-005");
      }),
    );
  });

  it("CHECK: a RETIRO_PRESENCIAL entrega cannot carry a repartidor", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedPreparada(tx, "ent005-retiro");
        const repartidorId = await insertRepartidor(tx, tenantId, sistema);

        await expectDbRejection(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id, repartidor_id) VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3, $4)`, [
              tenantId,
              recetaId,
              sistema,
              repartidorId,
            ]),
          "23514",
        );
      }),
    );
  });

  it("FK: the repartidor of an entrega must belong to the same tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedPreparada(tx, "ent005-tenant-a");
        const otroTenantId = await insertTenant(tx, "ent005-tenant-b");
        const otroSistema = await createSistemaUser(tx, otroTenantId);
        const repartidorAjeno = await insertRepartidor(tx, otroTenantId, otroSistema);

        await expectDbRejection(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id, repartidor_id) VALUES ($1, $2, 'ENVIO', $3, $4)`, [
              tenantId,
              recetaId,
              sistema,
              repartidorAjeno,
            ]),
          "23503",
        );
      }),
    );
  });

  it("repartidor: nombre, apellido and telefono cannot be blank", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "repartidor-check");
        const sistema = await createSistemaUser(tx, tenantId);

        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.repartidor (tenant_id, nombre, apellido, telefono, creado_por_id) VALUES ($1, '  ', 'Repartidor', '000-0000', $2)`, [tenantId, sistema]),
          "23514",
        );
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.repartidor (tenant_id, nombre, apellido, telefono, creado_por_id) VALUES ($1, 'Test', 'Repartidor', '', $2)`, [tenantId, sistema]),
          "23514",
        );
      }),
    );
  });
});
