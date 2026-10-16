/**
 * DB tests for prisma/migrations/.../0019_cierre_jornada_guards.
 *
 *   HOLE 1 -- INV-C03 used to protect only fsj.movimiento_stock (0015).
 *   fsj.asiento_recetario and fsj.asiento_contralor now reject an INSERT
 *   whose (trigger-assigned) fecha_asiento already has a fsj.cierre_diario
 *   row, via trg_asiento_recetario_validar_jornada_cerrada /
 *   trg_asiento_contralor_validar_jornada_cerrada.
 *
 *   HOLE 2 -- fsj.cierre_diario_firmar rejects p_fecha in the future
 *   (INV-C21, migration 0019). Since migration 0075 (DP-18b revised) it also
 *   rejects TODAY: only a jornada before the current one can be signed, so
 *   tests that sign what they just created advance the clock first.
 *
 * See tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/fixtures.ts for the shared seed helpers. A second, strictly-later
 * jornada is obtained by pinning explicit instants via `setRelojPrueba`
 * (prisma/migrations/.../0024_jornada_reloj_de_prueba) rather than waiting
 * for real time to pass -- see tests/db/helpers.ts#setRelojPrueba.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, setRelojPrueba, avanzarJornadas } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  crearLibrosRubricados,
  createUserWithRole,
  designarDt,
  seedAsientoSistema,
  insertAsientoSistema,
  insertFicha,
  insertItemAdicional,
  type AsientoSistemaResult,
} from "./fixtures";

/** See tests/db/libro-recetario.test.ts's identical helper for why a NEW item_receta is needed (INV-P02 + migration 0077 R19). */
async function insertPreparacionAdicional(tx: Client, seed: AsientoSistemaResult): Promise<string> {
  const itemRecetaId = await insertItemAdicional(tx, seed);
  const fichaTecnicaId = await insertFicha(tx, { tenantId: seed.tenantId, itemRecetaId, generadaPorId: seed.sistema });
  await tx.query(
    `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, orden)
     VALUES ($1, $2, $3, 'D', 1, 1, $4, 0)`,
    [seed.tenantId, fichaTecnicaId, seed.drogaId, seed.unidadId],
  );
  const result = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [seed.tenantId, fichaTecnicaId, seed.sistema],
  );
  return result.rows[0].id as string;
}

async function insertAsientoSistemaAdicional(tx: Client, seed: AsientoSistemaResult): Promise<{ id: string; fechaAsiento: string }> {
  const preparacionId = await insertPreparacionAdicional(tx, seed);
  const result = await insertAsientoSistema(tx, {
    tenantId: seed.tenantId,
    preparacionId,
    registradoPorId: seed.sistema,
    pacienteTexto: "Paciente",
    medicoTexto: "Medico - MAT-1",
    formulaTexto: "Formula",
  });
  return { id: result.id, fechaAsiento: result.fechaAsiento };
}

async function crearDtVigente(tx: Client, seed: AsientoSistemaResult, vigenteDesde = "2000-01-01"): Promise<{ dtId: string; designacionId: string }> {
  const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dt");
  const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema, vigenteDesde);
  return { dtId, designacionId };
}

async function firmar(
  tx: Client,
  tenantId: string,
  fecha: string,
  dtId: string,
  designacionId: string,
  motivoDemora: string | null = null,
): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4, $5, NULL)`, [
    tenantId,
    fecha,
    dtId,
    designacionId,
    motivoDemora,
  ]);
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0019_cierre_jornada_guards (fsj schema)", () => {
  it("HOLE 1a / INV-C03: an asiento_recetario insert succeeds while the jornada is open, and is rejected once it is signed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "c03rec");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);

        // Still open: a second SISTEMA asiento for the same jornada succeeds.
        const asiento2 = await insertAsientoSistemaAdicional(tx, seed);
        expect(asiento2.id).toBeTruthy();

        const fecha = asiento2.fechaAsiento;
        // INV-C21 (migration 0075): sign on the day after, then pin the clock
        // back to the signed jornada so the inserts below really land in it.
        const desde = await avanzarJornadas(tx);
        await firmar(tx, seed.tenantId, fecha, dtId, designacionId);
        await setRelojPrueba(tx, desde);

        // Now signed: a THIRD SISTEMA asiento for the same jornada must be rejected.
        // If trg_asiento_recetario_validar_jornada_cerrada is removed, this
        // insert succeeds and the assertion below fails. The detalle_asiento
        // and asiento_preparacion rows are inserted first (INV-L22/INV-L25,
        // migrations 0034/0082 -- fixtures.ts#insertAsientoSistema) so the
        // insert gets far enough to hit INV-C03, not fail earlier.
        await expectInvariantViolation(
          tx,
          async () => {
            const preparacionId = await insertPreparacionAdicional(tx, seed);
            return insertAsientoSistema(tx, { tenantId: seed.tenantId, preparacionId, registradoPorId: seed.sistema, descripcion: "Droga" });
          },
          "INV-C03",
        );
      }),
    );
  });

  it("HOLE 1b / INV-C03: an asiento_contralor insert succeeds while the jornada is open, and is rejected once it is signed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "c03con");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadResult = await tx.query(
          `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base) VALUES ($1,$1,'x','MASA',1,false) RETURNING id`,
          [`UM-C03CON-${randomUUID()}`],
        );
        const unidadId = unidadResult.rows[0].id as string;
        const drogaResult = await tx.query(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, es_controlada, tipo_control) VALUES ($1,$2,$3,true,'PSICOTROPICO') RETURNING id`,
          [tenantId, `Droga-${randomUUID()}`, unidadId],
        );
        const drogaId = drogaResult.rows[0].id as string;
        await tx.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = now() - interval '1 day' WHERE id = $1`, [tenantId]);
        const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "c03con");
        const { designacionId } = await designarDt(tx, tenantId, dtId, sistema);

        // Still open: the APERTURA succeeds.
        const apertura = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'D', 100, $3, $4) RETURNING id, fecha_asiento::text`,
          [tenantId, drogaId, unidadId, sistema],
        );
        expect(apertura.rows[0].id).toBeTruthy();
        const fecha = apertura.rows[0].fecha_asiento as string;

        // INV-C21 (migration 0075): sign on the day after, then pin the clock
        // back to the signed jornada so the INGRESO below really lands in it.
        const desde = await avanzarJornadas(tx);
        await firmar(tx, tenantId, fecha, dtId, designacionId);
        await setRelojPrueba(tx, desde);

        // Now signed: a further movement (INGRESO) on this jornada must be rejected.
        // If trg_asiento_contralor_validar_jornada_cerrada is removed, this
        // insert succeeds and the assertion below fails.
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, numero_vale_adquisicion, registrado_por_id)
               VALUES ($1, 'INGRESO', $2, 'D', 10, $3, 'VALE-C03', $4)`,
              [tenantId, drogaId, unidadId, sistema],
            ),
          "INV-C03",
        );
      }),
    );
  });

  it("HOLE 1a rectificativo: succeeds when its jornada is unsigned, and is rejected with INV-C03 once that jornada is signed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // Day D: two SISTEMA asientos, both to be signed together.
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "c03rectif");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const asiento2 = await insertAsientoSistemaAdicional(tx, seed);
        const fechaD = asiento2.fechaAsiento;

        // Move forward: TODAY is now D+1, strictly later, so D can be signed
        // (INV-C21, migration 0075) and D+1 stays unsigned.
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");
        await firmar(tx, seed.tenantId, fechaD, dtId, designacionId);
        const fechaD1 = (await tx.query(`SELECT fsj.jornada_actual($1)::text AS j`, [seed.tenantId])).rows[0].j as string;
        expect(fechaD1 > fechaD).toBe(true);

        // Rectificativo of seed.asientoId, dated D+1 (today, unsigned): succeeds.
        const rectificativo = await tx.query(
          `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
           VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida', $3)
           RETURNING id, fecha_asiento::text`,
          [seed.tenantId, seed.asientoId, seed.sistema],
        );
        expect(rectificativo.rows[0].fecha_asiento).toBe(fechaD1);

        // Sign D+1 from D+2 (INV-C21: only a past jornada), then pin the clock
        // back to D+1 so the rectificativo below really lands in the signed jornada.
        await setRelojPrueba(tx, "2026-06-17T12:00:00-03:00");
        await firmar(tx, seed.tenantId, fechaD1, dtId, designacionId);
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        // A rectificativo of asiento2 (a DIFFERENT original, so INV-L19 does
        // not interfere) is now dated into D+1, which is signed: rejected.
        // If trg_asiento_recetario_validar_jornada_cerrada is removed, this
        // insert succeeds and the assertion below fails.
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
               VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida', $3)`,
              [seed.tenantId, asiento2.id, seed.sistema],
            ),
          "INV-C03",
        );
      }),
    );
  });

  it("HOLE 2 / INV-C21: signing a FUTURE jornada or TODAY is rejected; once it is a PAST jornada it can be signed (migration 0075)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "c21");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const hoy = fecha.rows[0].fecha_asiento as string;
        const manana = (await tx.query(`SELECT ($1::date + 1)::text AS f`, [hoy])).rows[0].f as string;

        // Future: rejected. If the INV-C21 check is removed, this insert
        // succeeds and the assertion below fails.
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, manana, dtId, designacionId]),
          "INV-C21",
        );

        // Today: rejected too (migration 0075, DP-18b revised -- the cierre is
        // signed the day after).
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, hoy, dtId, designacionId]),
          "INV-C21",
        );

        // The next day it is a past jornada and signing succeeds (on time).
        await avanzarJornadas(tx);
        const cierreHoy = await firmar(tx, seed.tenantId, hoy, dtId, designacionId);
        expect(cierreHoy).toBeTruthy();
      }),
    );
  });

  it("HOLE 2 / INV-C21: a PAST jornada can be signed, also days late (only today and FUTURE dates are blocked)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // Day D, then move "now" forward so D becomes a PAST jornada
        // relative to "today".
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "c21past");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fechaD = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        await setRelojPrueba(tx, "2026-06-17T12:00:00-03:00");
        const hoy = (await tx.query(`SELECT fsj.jornada_actual($1)::text AS j`, [seed.tenantId])).rows[0].j as string;
        expect(hoy > fechaD.rows[0].fecha_asiento).toBe(true);

        // D is two days in the past: INV-C21 must NOT block it (INV-C18 requires
        // a motivo_demora since it is also fuera_de_termino from D+2 -- orthogonal).
        const cierreD = await firmar(tx, seed.tenantId, fechaD.rows[0].fecha_asiento, dtId, designacionId, "FALLA_SISTEMA");
        expect(cierreD).toBeTruthy();
      }),
    );
  });
});
