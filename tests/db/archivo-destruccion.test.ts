/**
 * DB tests for prisma/migrations/.../0042_archivo_destruccion (M15, FASE 12
 * points 12.1-12.3): per-tenant lote numbering, INV-ARC-007 (controlled
 * receta requires incluye_controladas), and the DP-26 PARCIAL parametro
 * seeding. See tests/db/helpers.ts for the rollback-transaction safety
 * model and tests/db/fixtures.ts for the shared seed helpers.
 *
 * NOT RUN as part of this task (migration 0042 has not been applied yet --
 * `npm run test:db` will pick this up once it is).
 */
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation } from "./helpers";
import { insertTenant, createSistemaUser, insertPaciente, insertMedico, insertReceta, insertItemReceta, insertComponente, insertUnidad, insertDroga } from "./fixtures";

async function insertLote(tx: Client, tenantId: string, sistema: string, incluyeControladas: boolean): Promise<{ id: string; numero: string }> {
  const result = await tx.query(
    `INSERT INTO fsj.lote_archivo_recetas (tenant_id, periodo_desde, periodo_hasta, ubicacion, incluye_controladas, registrado_por_id)
     VALUES ($1, '2024-01-01', '2024-01-31', 'Deposito A', $2, $3) RETURNING id, numero::text AS numero`,
    [tenantId, incluyeControladas, sistema],
  );
  return { id: result.rows[0].id as string, numero: result.rows[0].numero as string };
}

async function seedRecetaConDroga(tx: Client, suffix: string, esControlada: boolean): Promise<{ tenantId: string; sistema: string; recetaId: string }> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  if (esControlada) {
    await tx.query(`UPDATE fsj.droga SET tipo_control = 'PSICOTROPICO', es_controlada = true WHERE id = $1`, [drogaId]);
  }
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId });
  // Make the receta archivable: ANULADA (requires motivo_anulacion, INV-R08)
  // + receta_fisica_recibida.
  await tx.query(
    `UPDATE fsj.receta SET estado = 'ANULADA', motivo_anulacion = 'Test', receta_fisica_recibida = true, receta_fisica_recibida_en = now(), receta_fisica_recibida_por_id = $2
     WHERE tenant_id = $1 AND id = $3`,
    [tenantId, sistema, recetaId],
  );
  return { tenantId, sistema, recetaId };
}

describe.skipIf(dbTestSkipReason() !== null)("0042_archivo_destruccion migration (fsj schema)", () => {
  it("assigns per-tenant sequential numero starting at 1, unique per tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "numero");
        const sistema = await createSistemaUser(tx, tenantId);

        const lote1 = await insertLote(tx, tenantId, sistema, false);
        const lote2 = await insertLote(tx, tenantId, sistema, false);

        expect(lote1.numero).toBe("1");
        expect(lote2.numero).toBe("2");
      }),
    );
  });

  it("two different tenants each start their own numero at 1 (per-tenant counter, not global)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "numA");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const tenantB = await insertTenant(tx, "numB");
        const sistemaB = await createSistemaUser(tx, tenantB);

        const loteA = await insertLote(tx, tenantA, sistemaA, false);
        const loteB = await insertLote(tx, tenantB, sistemaB, false);

        expect(loteA.numero).toBe("1");
        expect(loteB.numero).toBe("1");
      }),
    );
  });

  it("INV-ARC-007: a receta using a controlled droga cannot be assigned to a lote with incluye_controladas = false", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, recetaId } = await seedRecetaConDroga(tx, "arc007fail", true);
        const lote = await insertLote(tx, tenantId, await createSistemaUser(tx, tenantId), false);

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET lote_archivo_id = $1 WHERE tenant_id = $2 AND id = $3`, [lote.id, tenantId, recetaId]),
          "INV-ARC-007",
        );
      }),
    );
  });

  it("INV-ARC-007: a receta using a controlled droga CAN be assigned to a lote with incluye_controladas = true", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedRecetaConDroga(tx, "arc007ok", true);
        const lote = await insertLote(tx, tenantId, sistema, true);

        const result = await tx.query(`UPDATE fsj.receta SET lote_archivo_id = $1 WHERE tenant_id = $2 AND id = $3 RETURNING id`, [lote.id, tenantId, recetaId]);
        expect(result.rows[0].id).toBe(recetaId);
      }),
    );
  });

  it("a non-controlled receta can be assigned to a lote with incluye_controladas = false", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, recetaId } = await seedRecetaConDroga(tx, "noncontrolled", false);
        const lote = await insertLote(tx, tenantId, sistema, false);

        const result = await tx.query(`UPDATE fsj.receta SET lote_archivo_id = $1 WHERE tenant_id = $2 AND id = $3 RETURNING id`, [lote.id, tenantId, recetaId]);
        expect(result.rows[0].id).toBe(recetaId);
      }),
    );
  });

  it("DP-26 PARCIAL: plazo_archivo_comun_anios/plazo_archivo_controladas_anios accept the same rows migration 0042 + scripts/create-tenant.ts insert, defaults 2/3", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // A brand-new tenant (this raw fixture insert) gets no parametro
        // rows automatically -- migration 0042 only backfills tenants that
        // already existed when it ran; scripts/create-tenant.ts covers
        // every NEW tenant going forward with this exact INSERT shape.
        const tenantId = await insertTenant(tx, "params");
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
           VALUES
             ($1, 'plazo_archivo_comun_anios', 'NUMERO', '2', 'test'),
             ($1, 'plazo_archivo_controladas_anios', 'NUMERO', '3', 'test')
           ON CONFLICT (tenant_id, clave) DO NOTHING`,
          [tenantId],
        );

        const result = await tx.query(
          `SELECT clave, valor FROM fsj.parametro WHERE tenant_id = $1 AND clave LIKE 'plazo_archivo_%' ORDER BY clave`,
          [tenantId],
        );
        expect(result.rows).toEqual([
          { clave: "plazo_archivo_comun_anios", valor: "2" },
          { clave: "plazo_archivo_controladas_anios", valor: "3" },
        ]);
      }),
    );
  });
});
