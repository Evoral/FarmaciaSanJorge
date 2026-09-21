/**
 * DB tests for prisma/migrations/.../0014_libro_recetario_contralor --
 * the contralor half: tenant.fecha_activacion_contralor (INV-L17),
 * fsj.asiento_contralor (INV-L08, L11-L16), and
 * movimiento_stock.numero_vale_adquisicion. Also migration 0018's B1
 * (saldo read under the counter lock) and the contralor half of B2 (V2
 * hash). See tests/db/helpers.ts for
 * the rollback-transaction safety model and tests/db/fixtures.ts for the
 * shared seed helpers.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  crearLibrosRubricados,
  insertUnidad,
  insertPaciente,
  insertMedico,
  insertReceta,
  insertItemReceta,
  insertComponente,
  insertFicha,
  insertLinea,
  insertProveedor,
  crearPartidaConIngreso,
  createUserWithRole,
  designarDt,
  hashV2,
} from "./fixtures";

async function insertDrogaControlada(tx: Client, tenantId: string, unidadId: string, tipoControl: string): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, es_controlada, tipo_control) VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [tenantId, `Droga-${randomUUID()}`, unidadId, tipoControl],
  );
  return result.rows[0].id as string;
}

async function activarContralor(tx: Client, tenantId: string): Promise<void> {
  await tx.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = now() - interval '1 day' WHERE id = $1`, [tenantId]);
}

async function openLibroId(tx: Client, tenantId: string, tipo: string): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.libro_rubricado WHERE tenant_id = $1 AND tipo = $2 AND fecha_cierre IS NULL`, [
    tenantId,
    tipo,
  ]);
  return result.rows[0].id as string;
}

/**
 * Full chain producing an EGRESO_PREPARACION movimiento_stock + its SISTEMA
 * asiento_recetario, for a GIVEN (already-controlled) droga.
 *
 * `partidaId`, if given, is REUSED instead of creating a fresh partida (and
 * therefore a fresh INGRESO_COMPRA movement). This matters whenever the
 * caller is going to run the INV-L08 deferred check (`SET CONSTRAINTS ALL
 * IMMEDIATE`): a brand-new INGRESO_COMPRA on a controlled droga ALSO needs
 * its own matching asiento_contralor row (INV-L08 applies to every
 * controlled movement, not just the one under test), and creating one here
 * would silently inflate the droga's saldo by cantidadInicial, breaking any
 * saldo assertions the caller has already worked out by hand. Callers that
 * never run the deferred check (e.g. INV-L14) can omit `partidaId` and get
 * a fresh, pre-funded partida for free.
 */
async function crearEgresoPreparacion(
  tx: Client,
  input: { tenantId: string; sistema: string; drogaId: string; unidadId: string; cantidad: number; partidaId?: string },
): Promise<{ movimientoId: string; asientoId: string; partidaId: string }> {
  const pacienteId = await insertPaciente(tx, input.tenantId);
  const medicoId = await insertMedico(tx, input.tenantId);
  const recetaId = await insertReceta(tx, { tenantId: input.tenantId, pacienteId, medicoId, registradaPorId: input.sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId: input.tenantId, recetaId });
  await insertComponente(tx, {
    tenantId: input.tenantId,
    itemRecetaId,
    drogaId: input.drogaId,
    unidadMedidaId: input.unidadId,
    modoExpresion: "TOTAL",
    cantidad: input.cantidad,
  });
  const fichaTecnicaId = await insertFicha(tx, { tenantId: input.tenantId, itemRecetaId, generadaPorId: input.sistema });
  const lineaPesajeId = await insertLinea(tx, {
    tenantId: input.tenantId,
    fichaTecnicaId,
    drogaId: input.drogaId,
    unidadMedidaId: input.unidadId,
    cantidadTeorica: input.cantidad,
    cantidadAPesar: input.cantidad,
  });

  let partidaId = input.partidaId;
  if (!partidaId) {
    const proveedorId = await insertProveedor(tx, input.tenantId);
    partidaId = await crearPartidaConIngreso(tx, {
      tenantId: input.tenantId,
      drogaId: input.drogaId,
      proveedorId,
      registradoPorId: input.sistema,
      cantidadInicial: 10_000,
      numeroValeAdquisicion: `VALE-${randomUUID()}`,
    });
  }

  const preparacionResult = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [input.tenantId, fichaTecnicaId, input.sistema],
  );
  const preparacionId = preparacionResult.rows[0].id as string;

  const movimientoResult = await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
     VALUES ($1, $2, 'EGRESO_PREPARACION', $3, $4, $5, $6) RETURNING id`,
    [input.tenantId, partidaId, input.cantidad, preparacionId, lineaPesajeId, input.sistema],
  );
  const movimientoId = movimientoResult.rows[0].id as string;

  const asientoResult = await tx.query(
    `INSERT INTO fsj.asiento_recetario (tenant_id, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
     VALUES ($1, 'SISTEMA', $2, 'Paciente', 'Medico - MAT-1', 'Formula', $3) RETURNING id`,
    [input.tenantId, preparacionId, input.sistema],
  );
  const asientoId = asientoResult.rows[0].id as string;

  await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
    input.sistema,
    preparacionId,
  ]);

  return { movimientoId, asientoId, partidaId };
}

describe.skipIf(dbTestSkipReason() !== null)("0014_libro_recetario_contralor migration -- contralor (fsj schema)", () => {
  it("contralor DISABLED: a movimiento_stock on a controlled droga generates NO asiento_contralor row (deferred check passes with zero rows)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "disabled");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "disabled");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "PSICOTROPICO");
        // fecha_activacion_contralor stays NULL.

        const proveedorId = await insertProveedor(tx, tenantId);
        await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema, cantidadInicial: 100 });

        const count = await tx.query(`SELECT count(*)::int AS n FROM fsj.asiento_contralor WHERE tenant_id = $1`, [tenantId]);
        expect(count.rows[0].n).toBe(0);

        // The INV-L08 deferred trigger must NOT complain -- contralor is off.
        await tx.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      }),
    );
  });

  it("contralor ENABLED: APERTURA is required first and unique per (droga, libro) -- INV-L15", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "apertura");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "apertura");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "PSICOTROPICO");
        await activarContralor(tx, tenantId);
        const libroId = await openLibroId(tx, tenantId, "PSICOTROPICO");

        // A non-APERTURA movement before any APERTURA exists is rejected.
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, numero_vale_adquisicion, registrado_por_id)
               VALUES ($1, 'INGRESO', $2, 'Droga X', 10, $3, 'VALE-1', $4)`,
              [tenantId, drogaId, unidadId, sistema],
            ),
          "INV-L15",
        );

        const apertura = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'Droga X', 100, $3, $4)
           RETURNING numero_correlativo, saldo_anterior, saldo_posterior, libro_id`,
          [tenantId, drogaId, unidadId, sistema],
        );
        expect(String(apertura.rows[0].numero_correlativo)).toBe("1");
        expect(Number(apertura.rows[0].saldo_anterior)).toBe(0);
        expect(Number(apertura.rows[0].saldo_posterior)).toBe(100);
        expect(apertura.rows[0].libro_id).toBe(libroId);

        // A second APERTURA for the SAME droga+libro is rejected.
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
               VALUES ($1, 'APERTURA', $2, 'Droga X', 50, $3, $4)`,
              [tenantId, drogaId, unidadId, sistema],
            ),
          "INV-L15",
        );
      }),
    );
  });

  it("contralor ENABLED: INGRESO/EGRESO/AJUSTE each compute correct saldos and generate exactly one row per movimiento (INV-L08/L12/L13, AJUSTE always subtracts)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "flujo");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "flujo");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "ESTUPEFACIENTE");
        await activarContralor(tx, tenantId);
        const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "flujo");
        await designarDt(tx, tenantId, dtId, sistema);

        // APERTURA: 100.
        await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'Droga Y', 100, $3, $4)`,
          [tenantId, drogaId, unidadId, sistema],
        );

        // INGRESO: +50 (requires numero_vale_adquisicion -- INV-L16).
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaIngreso = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 50,
          numeroValeAdquisicion: "VALE-INGRESO-1",
        });
        const movIngreso = await tx.query(
          `SELECT id FROM fsj.movimiento_stock WHERE tenant_id = $1 AND partida_id = $2 AND tipo = 'INGRESO_COMPRA'`,
          [tenantId, partidaIngreso],
        );
        const ingreso = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, numero_vale_adquisicion, registrado_por_id)
           VALUES ($1, 'INGRESO', $2, 'Droga Y', 50, $3, $4, 'VALE-INGRESO-1', $5)
           RETURNING saldo_anterior, saldo_posterior`,
          [tenantId, drogaId, unidadId, movIngreso.rows[0].id, sistema],
        );
        expect(Number(ingreso.rows[0].saldo_anterior)).toBe(100);
        expect(Number(ingreso.rows[0].saldo_posterior)).toBe(150);

        // EGRESO: -30 (via a confirmed preparacion). Reuses partidaIngreso
        // (already has its own accounted-for asiento_contralor row above)
        // instead of minting a fresh, unaccounted INGRESO -- see
        // crearEgresoPreparacion's doc comment.
        const egreso = await crearEgresoPreparacion(tx, { tenantId, sistema, drogaId, unidadId, cantidad: 30, partidaId: partidaIngreso });
        const asientoEgreso = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, asiento_recetario_id, registrado_por_id)
           VALUES ($1, 'EGRESO', $2, 'Droga Y', 30, $3, $4, $5, $6)
           RETURNING saldo_anterior, saldo_posterior`,
          [tenantId, drogaId, unidadId, egreso.movimientoId, egreso.asientoId, sistema],
        );
        expect(Number(asientoEgreso.rows[0].saldo_anterior)).toBe(150);
        expect(Number(asientoEgreso.rows[0].saldo_posterior)).toBe(120);

        // AJUSTE: always subtracts, -20, even though it's an "adjustment"
        // (DP-21b analogue / spec [CONFLICTO] resolution). Reuses
        // partidaIngreso (20 left: 50 - 30) instead of minting a fresh,
        // unaccounted INGRESO -- see crearEgresoPreparacion's doc comment
        // above for why that matters once SET CONSTRAINTS ALL IMMEDIATE runs.
        const movAjuste = await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, registrado_por_id, autorizado_por_id)
           VALUES ($1, $2, 'AJUSTE', 20, 'DIFERENCIA_ARQUEO', $3, $4) RETURNING id`,
          [tenantId, partidaIngreso, sistema, dtId],
        );
        const ajuste = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, registrado_por_id)
           VALUES ($1, 'AJUSTE', $2, 'Droga Y', 20, $3, $4, $5)
           RETURNING saldo_anterior, saldo_posterior`,
          [tenantId, drogaId, unidadId, movAjuste.rows[0].id, sistema],
        );
        expect(Number(ajuste.rows[0].saldo_anterior)).toBe(120);
        expect(Number(ajuste.rows[0].saldo_posterior)).toBe(100); // subtracted, not added

        // Exactly one asiento_contralor row per movimiento_stock (4 total: INGRESO, EGRESO, AJUSTE -- APERTURA has none).
        const total = await tx.query(`SELECT count(*)::int AS n FROM fsj.asiento_contralor WHERE tenant_id = $1`, [tenantId]);
        expect(total.rows[0].n).toBe(4);

        // INV-L08 deferred check now passes (every controlled movement has its match).
        await tx.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      }),
    );
  });

  it("INV-L08: a controlled movimiento_stock WITHOUT a matching asiento_contralor is rejected at commit (deferred)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "l08");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "l08");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "PSICOTROPICO");
        await activarContralor(tx, tenantId);

        const proveedorId = await insertProveedor(tx, tenantId);
        // A controlled INGRESO with NO matching asiento_contralor row at all.
        await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          numeroValeAdquisicion: "VALE-SOLO",
        });

        await expectInvariantViolation(tx, () => tx.query(`SET CONSTRAINTS ALL IMMEDIATE`), "INV-L08");
      }),
    );
  });

  it("INV-L14: saldo_posterior can never go negative (an EGRESO/AJUSTE larger than the balance is rejected)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "negativo");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "negativo");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "PSICOTROPICO");
        await activarContralor(tx, tenantId);

        await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'Droga Z', 10, $3, $4)`,
          [tenantId, drogaId, unidadId, sistema],
        );

        const egreso = await crearEgresoPreparacion(tx, { tenantId, sistema, drogaId, unidadId, cantidad: 50 });

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, asiento_recetario_id, registrado_por_id)
               VALUES ($1, 'EGRESO', $2, 'Droga Z', 50, $3, $4, $5, $6)`,
              [tenantId, drogaId, unidadId, egreso.movimientoId, egreso.asientoId, sistema],
            ),
          "INV-L14",
        );
      }),
    );
  });

  it("INV-L16: an INGRESO_COMPRA of a controlled droga requires numero_vale_adquisicion once the contralor is active", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "l16");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "l16");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "PSICOTROPICO");
        await activarContralor(tx, tenantId);
        const proveedorId = await insertProveedor(tx, tenantId);

        await expectInvariantViolation(
          tx,
          () => crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema, cantidadInicial: 10 }), // no vale
          "INV-L16",
        );

        // With a vale, it succeeds.
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          numeroValeAdquisicion: "VALE-OK",
        });
        expect(partidaId).toBeTruthy();
      }),
    );
  });

  it("INV-L17: tenant.fecha_activacion_contralor cannot revert to NULL (or change at all) once set", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "l17");
        await activarContralor(tx, tenantId);

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = NULL WHERE id = $1`, [tenantId]),
          "INV-L17",
        );

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = now() WHERE id = $1`, [tenantId]),
          "INV-L17",
        );
      }),
    );
  });

  it("asiento_contralor is fully immutable except cierre_diario_id (no UPDATE/DELETE grant for fsj_app)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "immutable");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "immutable");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "PSICOTROPICO");
        await activarContralor(tx, tenantId);
        const apertura = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'Droga W', 10, $3, $4) RETURNING id`,
          [tenantId, drogaId, unidadId, sistema],
        );

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.asiento_contralor SET cantidad = 999 WHERE id = $1`, [apertura.rows[0].id]),
          "42501",
        );
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.asiento_contralor WHERE id = $1`, [apertura.rows[0].id]), "42501");
      }),
    );
  });
});

// ============================================================================
// Migration 0018 -- B1 (contralor saldo race) + B2 (V2 hash on the contralor).
// ============================================================================
describe.skipIf(dbTestSkipReason() !== null)("0018_legal_core_fixes -- B1 contralor saldo under lock (fsj schema)", () => {
  it("two consecutive movements of the same droga: saldo_anterior of the 2nd equals saldo_posterior of the 1st (INV-L13)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "b1seq");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "b1seq");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "PSICOTROPICO");
        await activarContralor(tx, tenantId);

        await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'Droga B1', 10, $3, $4)`,
          [tenantId, drogaId, unidadId, sistema],
        );

        const proveedorId = await insertProveedor(tx, tenantId);
        const saldos: Array<{ anterior: number; posterior: number }> = [];
        for (const cantidad of [7, 5]) {
          const vale = `VALE-B1-${randomUUID()}`;
          const partidaId = await crearPartidaConIngreso(tx, {
            tenantId,
            drogaId,
            proveedorId,
            registradoPorId: sistema,
            cantidadInicial: cantidad,
            numeroValeAdquisicion: vale,
          });
          const mov = await tx.query(`SELECT id FROM fsj.movimiento_stock WHERE tenant_id = $1 AND partida_id = $2`, [tenantId, partidaId]);
          const r = await tx.query(
            `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, numero_vale_adquisicion, registrado_por_id)
             VALUES ($1, 'INGRESO', $2, 'Droga B1', $3, $4, $5, $6, $7)
             RETURNING saldo_anterior, saldo_posterior`,
            [tenantId, drogaId, cantidad, unidadId, mov.rows[0].id, vale, sistema],
          );
          saldos.push({ anterior: Number(r.rows[0].saldo_anterior), posterior: Number(r.rows[0].saldo_posterior) });
        }

        expect(saldos[0]).toEqual({ anterior: 10, posterior: 17 });
        expect(saldos[1].anterior).toBe(saldos[0].posterior);
        expect(saldos[1]).toEqual({ anterior: 17, posterior: 22 });

        // The whole contralor chain verifies (V2).
        const libroId = await openLibroId(tx, tenantId, "PSICOTROPICO");
        const verif = await tx.query(`SELECT fsj.verificar_cadena($1, $2) AS roto`, [tenantId, libroId]);
        expect(verif.rows[0].roto).toBeNull();
      }),
    );
  });

  it(
    "STRUCTURAL guard (not a race test): asiento_contralor_preparar locks the lower-ranked counters, then its own counter, " +
      "and only THEN reads the previous saldo with a plain SELECT",
    async () => {
      // HONEST SCOPE: a real two-connection race on this trigger cannot run
      // in this harness (it needs committed, undeletable fixture data -- see
      // the concurrency test at the bottom of tests/db/libro-recetario.test.ts).
      // This test only pins the ORDER of the statements inside the trigger
      // body, which is what the B1 fix is about: with the counter lock taken
      // first, the later saldo SELECT runs in a fresh READ COMMITTED snapshot
      // taken after the lock wait (migration 0018 header). If someone moves
      // the saldo read back above the counter lock, or re-adds a row-level
      // FOR UPDATE on it, this fails.
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const def = await tx.query(`SELECT pg_get_functiondef('fsj.asiento_contralor_preparar()'::regprocedure) AS d`);
          const body = def.rows[0].d as string;

          const lockInferiores = body.indexOf("FOR UPDATE OF c");
          const tomar = body.indexOf("FROM fsj.contador_correlativo_tomar(");
          const leerSaldo = body.indexOf("SELECT saldo_posterior INTO v_prev_saldo");

          expect(lockInferiores).toBeGreaterThan(-1);
          expect(tomar).toBeGreaterThan(-1);
          expect(leerSaldo).toBeGreaterThan(-1);
          expect(lockInferiores).toBeLessThan(tomar);
          expect(tomar).toBeLessThan(leerSaldo);

          // The saldo read itself must not carry a row lock anymore (the
          // LIMIT 1 FOR UPDATE pattern is exactly what missed newer rows).
          const saldoStatement = body.slice(leerSaldo, body.indexOf(";", leerSaldo));
          expect(saldoStatement).not.toMatch(/FOR\s+UPDATE/i);

          // Lower-ranked counters are locked in a fixed order (deadlock freedom).
          expect(body).toMatch(/ORDER BY l\.tipo, l\.id\s+FOR UPDATE OF c/);
        }),
      );
    },
  );

  it("asiento_contralor hash_integridad follows the documented V2 serialization (independent Node recomputation)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "b2contralor");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadId = await insertUnidad(tx, "b2contralor");
        const drogaId = await insertDrogaControlada(tx, tenantId, unidadId, "ESTUPEFACIENTE");
        await activarContralor(tx, tenantId);

        const inserted = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'Morfina clorhidrato', 12.500, $3, $4) RETURNING id`,
          [tenantId, drogaId, unidadId, sistema],
        );
        const row = await tx.query(
          `SELECT tenant_id, libro_id, numero_correlativo, to_char(fecha_asiento, 'YYYY-MM-DD') AS fecha, tipo_movimiento, droga_id,
                  droga_descripcion, cantidad::text AS cantidad, unidad_medida_id, saldo_anterior::text AS saldo_anterior,
                  saldo_posterior::text AS saldo_posterior, movimiento_stock_id, asiento_recetario_id, numero_vale_adquisicion,
                  hash_anterior, hash_integridad
           FROM fsj.asiento_contralor WHERE id = $1`,
          [inserted.rows[0].id],
        );
        const r = row.rows[0];
        expect(r.cantidad).toBe("12.500"); // numeric scale as stored is part of the canonical form
        const spec = hashV2([
          "FSJ-ASIENTO-CONTRALOR-V2",
          r.tenant_id,
          r.libro_id,
          String(r.numero_correlativo),
          r.fecha,
          r.tipo_movimiento,
          r.droga_id,
          r.droga_descripcion,
          r.cantidad,
          r.unidad_medida_id,
          r.saldo_anterior,
          r.saldo_posterior,
          r.movimiento_stock_id,
          r.asiento_recetario_id,
          r.numero_vale_adquisicion,
          r.hash_anterior,
        ]);
        expect(r.hash_integridad).toBe(spec);
      }),
    );
  });
});
