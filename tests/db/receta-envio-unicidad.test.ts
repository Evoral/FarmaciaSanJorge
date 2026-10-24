/**
 * DB tests for security audit finding P3-09 (migration 0102_receta_envio_id).
 *
 * Verifies that the unique partial index `uq_receta_envio` on `fsj.receta (tenant_id, envio_id)`:
 * 1. Rejects duplicate (tenant_id, envio_id) with unique violation 23505.
 * 2. Allows the same envio_id in a different tenant (tenant isolation).
 * 3. Allows multiple recetas with NULL envio_id in the same tenant.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectDbRejection } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  insertPaciente,
  insertMedico,
} from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("P3-09: uq_receta_envio idempotency constraint (0102)", () => {
  it("rejects duplicate envio_id in same tenant, allows in different tenant, allows multiple nulls", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // Setup Tenant A
        const tenantA = await insertTenant(tx, "Tenant A Idempotency");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const pacienteA = await insertPaciente(tx, tenantA);
        const medicoA = await insertMedico(tx, tenantA);

        // Setup Tenant B
        const tenantB = await insertTenant(tx, "Tenant B Idempotency");
        const sistemaB = await createSistemaUser(tx, tenantB);
        const pacienteB = await insertPaciente(tx, tenantB);
        const medicoB = await insertMedico(tx, tenantB);

        const envioId = randomUUID();

        // 1. Insert first receta in Tenant A with envioId -> succeeds
        const res1 = await tx.query<{ id: string }>(
          `INSERT INTO fsj.receta
             (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id, envio_id)
           VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4, $5)
           RETURNING id`,
          [tenantA, pacienteA, medicoA, sistemaA, envioId],
        );
        expect(res1.rows[0].id).toBeDefined();

        // 2. Insert second receta in Tenant A with duplicate envioId -> rejected with 23505
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.receta
                 (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id, envio_id)
               VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4, $5)`,
              [tenantA, pacienteA, medicoA, sistemaA, envioId],
            ),
          "23505",
        );

        // 3. Insert receta in Tenant B with the SAME envioId -> succeeds
        const resB = await tx.query<{ id: string }>(
          `INSERT INTO fsj.receta
             (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id, envio_id)
           VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4, $5)
           RETURNING id`,
          [tenantB, pacienteB, medicoB, sistemaB, envioId],
        );
        expect(resB.rows[0].id).toBeDefined();

        // 4. Multiple recetas with NULL envio_id in Tenant A -> both succeed
        const resNull1 = await tx.query<{ id: string }>(
          `INSERT INTO fsj.receta
             (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id, envio_id)
           VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4, NULL)
           RETURNING id`,
          [tenantA, pacienteA, medicoA, sistemaA],
        );
        const resNull2 = await tx.query<{ id: string }>(
          `INSERT INTO fsj.receta
             (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id, envio_id)
           VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4, NULL)
           RETURNING id`,
          [tenantA, pacienteA, medicoA, sistemaA],
        );
        expect(resNull1.rows[0].id).toBeDefined();
        expect(resNull2.rows[0].id).toBeDefined();
      }),
    );
  });
});
