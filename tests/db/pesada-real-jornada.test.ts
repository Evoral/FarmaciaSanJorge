/**
 * DB tests for security audit finding P3-04 (migration 0103_pesada_real_jornada).
 *
 * Verifies that fsj.pesada_real_validar_autorizacion checks DT co-firma authorization
 * against the farmacia's local jornada (fsj.jornada_actual(tenant_id)), NOT server UTC
 * current_date.
 *
 * Between 21:00 and 23:59 (UTC-3) in Argentina, the local date is D while UTC is D+1.
 * - A DT whose designation is vigente on day D (vigente_desde = D, vigente_hasta = D)
 *   is accepted by pesada_real.
 * - A DT whose designation begins on day D+1 (vigente_desde = D+1) is rejected
 *   with INV-U05 ("is not a DT vigente today") because the tenant's jornada is still D.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, setRelojPrueba, expectInvariantViolation } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  createUserWithRole,
  insertUnidad,
  insertDroga,
  insertPaciente,
  insertMedico,
  insertReceta,
  insertItemReceta,
  insertComponente,
  insertFicha,
  insertLinea,
} from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("P3-04: pesada_real authorization uses tenant jornada (0103)", () => {
  it("validates DT vigency against local jornada between 21:00 and 23:59 Argentina time", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "Farmacia P3-04");
        const sistema = await createSistemaUser(tx, tenantId);

        // Instant: 2026-10-23 at 22:30:00-03:00 (UTC: 2026-10-24 01:30:00Z)
        // Local jornada in Argentina: 2026-10-23
        await setRelojPrueba(tx, "2026-10-23T22:30:00-03:00");

        // Verify that fsj.jornada_actual resolves to 2026-10-23
        const jornadaRes = await tx.query<{ jornada: string }>(
          "SELECT fsj.jornada_actual($1)::text AS jornada",
          [tenantId],
        );
        expect(jornadaRes.rows[0].jornada).toBe("2026-10-23");

        // DT A: vigente exclusively on 2026-10-23
        const dtA = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt-a");
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico
             (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-A', '2026-10-23', '2026-10-23', $3)`,
          [tenantId, dtA, sistema],
        );

        // DT B: designation starts tomorrow 2026-10-24 (not yet vigente in current jornada)
        const dtB = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt-b");
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico
             (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-B', '2026-10-24', '2026-10-24', $3)`,
          [tenantId, dtB, sistema],
        );

        // Seed domain chain: unidad, droga, receta, item, ficha, lineas, preparacion
        const unidadId = await insertUnidad(tx, "g");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS" });
        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
        const linea1Id = await insertLinea(tx, { tenantId, fichaTecnicaId: fichaId, drogaId, unidadMedidaId: unidadId, orden: 0 });
        const linea2Id = await insertLinea(tx, { tenantId, fichaTecnicaId: fichaId, drogaId, unidadMedidaId: unidadId, orden: 1 });

        const prepRes = await tx.query<{ id: string }>(
          `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, fichaId, sistema],
        );
        const prepId = prepRes.rows[0].id;

        // 1. DT A is vigente on 2026-10-23: out-of-tolerance weighing with dtA co-signature succeeds
        const insertA = await tx.query(
          `INSERT INTO fsj.pesada_real
             (tenant_id, preparacion_id, linea_pesaje_id, cantidad_esperada, cantidad_real, margen, autorizado_por_id, registrado_por_id)
           VALUES ($1, $2, $3, 10, 15, 0.5, $4, $5)
           RETURNING id`,
          [tenantId, prepId, linea1Id, dtA, sistema],
        );
        expect(insertA.rows[0].id).toBeDefined();

        // 2. DT B is NOT vigente on 2026-10-23 (even if UTC date is 2026-10-24):
        // pesada_real with dtB co-signature must reject with INV-U05
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.pesada_real
                 (tenant_id, preparacion_id, linea_pesaje_id, cantidad_esperada, cantidad_real, margen, autorizado_por_id, registrado_por_id)
               VALUES ($1, $2, $3, 10, 15, 0.5, $4, $5)`,
              [tenantId, prepId, linea2Id, dtB, sistema],
            ),
          "INV-U05: pesada_real autorizado_por_id",
        );
      }),
    );
  });
});
