/**
 * DB tests for prisma/migrations/20261012090000_0074_reanalisis_partida (openspec/specs/reanalisis-partida/spec.md).
 *
 * Covers:
 * - INSERT partida copies fecha_vencimiento into fecha_vencimiento_vigente (client value ignored)
 * - UPDATE of fecha_vencimiento fails (INV-S23); direct UPDATE of fecha_vencimiento_vigente fails (INV-S23)
 * - Valid reanálisis moves vigente, stores fecha_vencimiento_anterior; second reanálisis chains from first
 * - INV-S22 rejections: insumo partida, saldo 0, fecha_reanalisis <= jornada, registrado_por not a DT vigente
 * - reanalisis_partida UPDATE and DELETE fail (INV-IMMUTABLE); RLS hides another tenant's rows
 * - INV-S10: EGRESO_PREPARACION against expired partida fails; after reanálisis to future date it succeeds
 * - v_stock_droga counts a reanalizada partida and excludes one whose vigente is past
 *
 * NOTE: Migration 0074 is NOT yet applied to the shared database.
 * This test file is written per specification and must NOT be run until migration 0074 is applied.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import {
  asOwner,
  inRollbackTx,
  withTenant,
  expectInvariantViolation,
  setRelojPrueba,
} from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  createUserWithRole,
  insertUnidad,
  insertDroga,
  insertProveedor,
  crearPartidaConIngreso,
  designarDt,
} from "./fixtures";

const JORNADA_INSTANT = "2026-06-15T12:00:00-03:00";
const JORNADA_DATE = "2026-06-15";
const FECHA_VENCIDA = "2026-05-01";
const FECHA_REANALISIS_1 = "2026-12-31";
const FECHA_REANALISIS_2 = "2027-06-30";

async function setupDrogaPartida(
  tx: Client,
  suffix: string,
  opts: {
    clase?: "DROGA" | "EXCIPIENTE" | "MATERIAL";
    fechaVencimiento?: string | null;
    cantidadInicial?: number;
  } = {},
) {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadId = await insertUnidad(tx, suffix);
  const proveedorId = await insertProveedor(tx, tenantId);

  const drogaRes = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `Droga-${randomUUID()}`, unidadId, opts.clase ?? "DROGA"],
  );
  const drogaId = drogaRes.rows[0].id as string;

  const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, `dt-${suffix}`);
  await designarDt(tx, tenantId, dtId, sistema);

  const partidaId = randomUUID();
  await tx.query(
    `INSERT INTO fsj.partida (id, tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
     VALUES ($1, $2, $3, $4, $5, 10, $6, $7)`,
    [
      partidaId,
      tenantId,
      drogaId,
      proveedorId,
      `LOTE-${randomUUID()}`,
      opts.cantidadInicial ?? 100,
      opts.fechaVencimiento ?? FECHA_VENCIDA,
    ],
  );

  await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
     VALUES ($1, $2, 'INGRESO_COMPRA', $3, $4)`,
    [tenantId, partidaId, opts.cantidadInicial ?? 100, sistema],
  );

  return { tenantId, sistema, unidadId, drogaId, proveedorId, dtId, partidaId };
}

async function insertPreparacionParaEgreso(
  tx: Client,
  tenantId: string,
  drogaId: string,
  unidadId: string,
  sistema: string,
): Promise<{ preparacionId: string; lineaPesajeId: string }> {
  const paciente = await tx.query(
    `INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'P', 'A') RETURNING id`,
    [tenantId],
  );
  const medico = await tx.query(
    `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'M', 'D', $2) RETURNING id`,
    [tenantId, `MAT-${randomUUID()}`],
  );
  const receta = await tx.query(
    `INSERT INTO fsj.receta (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id)
     VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4) RETURNING id`,
    [tenantId, paciente.rows[0].id, medico.rows[0].id, sistema],
  );
  const item = await tx.query(
    `INSERT INTO fsj.item_receta (tenant_id, receta_id, forma_farmaceutica, cantidad_unidades)
     VALUES ($1, $2, 'CREMA', 1) RETURNING id`,
    [tenantId, receta.rows[0].id],
  );
  await tx.query(
    `INSERT INTO fsj.componente_item_receta (tenant_id, item_receta_id, droga_id, cantidad, unidad_medida_id, modo_expresion)
     VALUES ($1, $2, $3, 10, $4, 'TOTAL')`,
    [tenantId, item.rows[0].id, drogaId, unidadId],
  );
  const ficha = await tx.query(
    `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id)
     VALUES ($1, $2, 1, $3) RETURNING id`,
    [tenantId, item.rows[0].id, sistema],
  );
  const linea = await tx.query(
    `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, orden)
     VALUES ($1, $2, $3, 'Droga', 10, 10, $4, 0) RETURNING id`,
    [tenantId, ficha.rows[0].id, drogaId, unidadId],
  );
  const prep = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, ficha.rows[0].id, sistema],
  );
  return { preparacionId: prep.rows[0].id as string, lineaPesajeId: linea.rows[0].id as string };
}

describe.skipIf(dbTestSkipReason() !== null)("0074 reanálisis de partida (INV-S22, INV-S23, INV-S10, v_stock_droga)", () => {
  it("INSERT partida copies fecha_vencimiento into fecha_vencimiento_vigente, ignoring client-supplied vigente", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "initvig");
        const unidadId = await insertUnidad(tx, "initvig");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);

        // Attempt to pass client-supplied fecha_vencimiento_vigente distinct from fecha_vencimiento
        const res = await tx.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, fecha_vencimiento_vigente)
           VALUES ($1, $2, $3, 'L-TEST', 10, 100, '2026-10-01', '2099-01-01')
           RETURNING fecha_vencimiento::text, fecha_vencimiento_vigente::text`,
          [tenantId, drogaId, proveedorId],
        );

        expect(res.rows[0].fecha_vencimiento).toBe("2026-10-01");
        // Trigger trg_partida_inicializar_vencimiento_vigente must have overwritten it with fecha_vencimiento
        expect(res.rows[0].fecha_vencimiento_vigente).toBe("2026-10-01");
      }),
    );
  });

  it("INV-S23: direct UPDATE of fecha_vencimiento or fecha_vencimiento_vigente fails", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { partidaId } = await setupDrogaPartida(tx, "updinv");

        // 1. Direct UPDATE of original fecha_vencimiento fails (INV-S23)
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.partida SET fecha_vencimiento = '2027-01-01' WHERE id = $1`, [partidaId]),
          "INV-S23",
        );

        // 2. Direct UPDATE of fecha_vencimiento_vigente fails without fsj.reanalisis = 'on' (INV-S23)
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.partida SET fecha_vencimiento_vigente = '2027-01-01' WHERE id = $1`, [partidaId]),
          "INV-S23",
        );
      }),
    );
  });

  it("valid reanálisis moves vigente, stores fecha_vencimiento_anterior; second reanálisis chains from first", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, JORNADA_INSTANT);
        const { tenantId, partidaId, dtId } = await setupDrogaPartida(tx, "reanok", {
          fechaVencimiento: FECHA_VENCIDA,
        });

        // First reanálisis
        const r1 = await tx.query(
          `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, motivo, respaldo, registrado_por_id)
           VALUES ($1, $2, $3, 'Primer reanálisis', 'Protocolo 1', $4)
           RETURNING id, fecha_vencimiento_anterior::text, fecha_reanalisis::text`,
          [tenantId, partidaId, FECHA_REANALISIS_1, dtId],
        );

        expect(r1.rows[0].fecha_vencimiento_anterior).toBe(FECHA_VENCIDA);
        expect(r1.rows[0].fecha_reanalisis).toBe(FECHA_REANALISIS_1);

        // Verify partida.fecha_vencimiento_vigente moved, original fecha_vencimiento untouched
        const p1 = await tx.query(
          `SELECT fecha_vencimiento::text, fecha_vencimiento_vigente::text FROM fsj.partida WHERE id = $1`,
          [partidaId],
        );
        expect(p1.rows[0].fecha_vencimiento).toBe(FECHA_VENCIDA);
        expect(p1.rows[0].fecha_vencimiento_vigente).toBe(FECHA_REANALISIS_1);

        // Second reanálisis chains from the first
        const r2 = await tx.query(
          `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, motivo, respaldo, registrado_por_id)
           VALUES ($1, $2, $3, 'Segundo reanálisis', 'Protocolo 2', $4)
           RETURNING id, fecha_vencimiento_anterior::text, fecha_reanalisis::text`,
          [tenantId, partidaId, FECHA_REANALISIS_2, dtId],
        );

        expect(r2.rows[0].fecha_vencimiento_anterior).toBe(FECHA_REANALISIS_1);
        expect(r2.rows[0].fecha_reanalisis).toBe(FECHA_REANALISIS_2);

        const p2 = await tx.query(
          `SELECT fecha_vencimiento::text, fecha_vencimiento_vigente::text FROM fsj.partida WHERE id = $1`,
          [partidaId],
        );
        expect(p2.rows[0].fecha_vencimiento).toBe(FECHA_VENCIDA);
        expect(p2.rows[0].fecha_vencimiento_vigente).toBe(FECHA_REANALISIS_2);
      }),
    );
  });

  it("INV-S22 rejections, each for its own reason: insumo, saldo 0, fecha_reanalisis <= jornada, registrado_por not a DT vigente", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, JORNADA_INSTANT);
        // ONE tenant for every case: a partida of another tenant would be rejected as "not found" and hide the rule.
        const { tenantId, sistema, unidadId, drogaId, proveedorId, dtId, partidaId } = await setupDrogaPartida(tx, "invs22");
        const reanalizar = (partida: string, fecha: string, registradoPorId: string) => () =>
          tx.query(
            `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, registrado_por_id)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, partida, fecha, registradoPorId],
          );

        // 1. Insumo partida (clase EXCIPIENTE, NULL fecha_vencimiento).
        const excipienteRes = await tx.query(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase) VALUES ($1, $2, $3, 'EXCIPIENTE') RETURNING id`,
          [tenantId, `Excipiente-${randomUUID()}`, unidadId],
        );
        const partidaInsumoRes = await tx.query(
          `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
           VALUES ($1, $2, $3, 'L-INS', 10, 100, NULL) RETURNING id`,
          [tenantId, excipienteRes.rows[0].id, proveedorId],
        );
        const partidaInsumoId = partidaInsumoRes.rows[0].id as string;
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', 100, $3)`,
          [tenantId, partidaInsumoId, sistema],
        );
        await expectInvariantViolation(tx, reanalizar(partidaInsumoId, FECHA_REANALISIS_1, dtId), "INV-S22: only a partida of a droga");

        // 2. Saldo 0: the whole saldo discounted by a VENCIMIENTO ajuste (what "marcar como vencida" does).
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, registrado_por_id, autorizado_por_id)
           VALUES ($1, $2, 'AJUSTE', 100, 'VENCIMIENTO', $3, $4)`,
          [tenantId, partidaId, sistema, dtId],
        );
        await expectInvariantViolation(tx, reanalizar(partidaId, FECHA_REANALISIS_1, dtId), "has no saldo (terminal)");

        // A second partida of the SAME tenant and droga, with saldo, for the remaining rules.
        const partidaConSaldoId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 100,
          fechaVencimiento: FECHA_VENCIDA,
        });

        // 3. fecha_reanalisis <= jornada (the jornada itself, and a past date).
        await expectInvariantViolation(tx, reanalizar(partidaConSaldoId, JORNADA_DATE, dtId), `must be after the jornada ${JORNADA_DATE}`);
        await expectInvariantViolation(tx, reanalizar(partidaConSaldoId, "2026-06-10", dtId), `must be after the jornada ${JORNADA_DATE}`);

        // 4a. registrado_por is not a DT at all.
        const farmaceuticoId = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "farm-invs22");
        await expectInvariantViolation(tx, reanalizar(partidaConSaldoId, FECHA_REANALISIS_1, farmaceuticoId), "is not a DT vigente today");

        // 4b. registrado_por holds the DIRECTOR_TECNICO role but has no designación vigente.
        const dtSinDesignacionId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt-sin-desig-invs22");
        await expectInvariantViolation(tx, reanalizar(partidaConSaldoId, FECHA_REANALISIS_1, dtSinDesignacionId), "is not a DT vigente today");

        // Control: the same partida, a future date and the designated DT pass -- every rejection above was for its rule.
        await reanalizar(partidaConSaldoId, FECHA_REANALISIS_1, dtId)();
        const vigente = await tx.query(`SELECT fecha_vencimiento_vigente::text AS v FROM fsj.partida WHERE id = $1`, [partidaConSaldoId]);
        expect(vigente.rows[0].v).toBe(FECHA_REANALISIS_1);
      }),
    );
  });

  it("reanalisis_partida UPDATE and DELETE fail (INV-IMMUTABLE); RLS hides another tenant's rows", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, JORNADA_INSTANT);
        const { tenantId: tenantA, partidaId, dtId } = await setupDrogaPartida(tx, "rlsa");

        const reanRes = await tx.query(
          `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, motivo, registrado_por_id)
           VALUES ($1, $2, $3, 'Motivo original', $4) RETURNING id`,
          [tenantA, partidaId, FECHA_REANALISIS_1, dtId],
        );
        const reanalisisId = reanRes.rows[0].id as string;

        // 1. UPDATE fails via forbid_update_delete trigger
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`UPDATE fsj.reanalisis_partida SET motivo = 'Modificado' WHERE id = $1`, [reanalisisId]),
          "INV-IMMUTABLE",
        );

        // 2. DELETE fails via forbid_update_delete trigger
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.reanalisis_partida WHERE id = $1`, [reanalisisId]),
          "INV-IMMUTABLE",
        );

        // 3. RLS hides rows across tenants under fsj_app
        const tenantB = await insertTenant(tx, "rlsb");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantB, async (appTx) => {
          const visible = await appTx.query(
            `SELECT count(*)::int AS total FROM fsj.reanalisis_partida WHERE id = $1`,
            [reanalisisId],
          );
          expect(visible.rows[0].total).toBe(0);
        });
        await tx.query("RESET ROLE");
      }),
    );
  });

  it("INV-S10: EGRESO_PREPARACION against expired partida fails; after reanálisis to future date it succeeds", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, JORNADA_INSTANT);
        const { tenantId, sistema, drogaId, unidadId, dtId, partidaId } = await setupDrogaPartida(tx, "invs10", {
          fechaVencimiento: FECHA_VENCIDA,
        });

        const { preparacionId, lineaPesajeId } = await insertPreparacionParaEgreso(tx, tenantId, drogaId, unidadId, sistema);

        // 1. EGRESO_PREPARACION against expired partida fails (INV-S10)
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
               VALUES ($1, $2, 'EGRESO_PREPARACION', 5, $3, $4, $5)`,
              [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
            ),
          "INV-S10",
        );

        // 2. Perform reanálisis to future date
        await tx.query(
          `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, motivo, registrado_por_id)
           VALUES ($1, $2, $3, 'Habilitación por reanálisis', $4)`,
          [tenantId, partidaId, FECHA_REANALISIS_1, dtId],
        );

        // 3. Now EGRESO_PREPARACION succeeds
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 5, $3, $4, $5)`,
          [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
        );

        // Check available quantity was decremented
        const saldoRes = await tx.query(`SELECT cantidad_disponible FROM fsj.partida WHERE id = $1`, [partidaId]);
        expect(Number(saldoRes.rows[0].cantidad_disponible)).toBe(95);
      }),
    );
  });

  it("v_stock_droga counts a reanalizada partida and excludes one whose vigente is past", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, JORNADA_INSTANT);
        const tenantId = await insertTenant(tx, "vstock");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "vstock");
        const proveedorId = await insertProveedor(tx, tenantId);

        const drogaRes = await tx.query(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase) VALUES ($1, 'Droga Test', $2, 'DROGA') RETURNING id`,
          [tenantId, unidadId],
        );
        const drogaId = drogaRes.rows[0].id as string;

        const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt-vstock");
        await designarDt(tx, tenantId, dtId, sistema);

        // Partida 1: expired, but will be reanalizada
        const p1Id = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 50,
          fechaVencimiento: FECHA_VENCIDA,
        });

        // Partida 2: expired, NOT reanalizada
        await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 30,
          fechaVencimiento: FECHA_VENCIDA,
        });

        // Initially both are expired: stock_disponible is 0
        const antes = await tx.query(
          `SELECT stock_disponible FROM fsj.v_stock_droga WHERE tenant_id = $1 AND droga_id = $2`,
          [tenantId, drogaId],
        );
        expect(Number(antes.rows[0]?.stock_disponible ?? 0)).toBe(0);

        // Reanalyse Partida 1 to a future date
        await tx.query(
          `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, motivo, registrado_por_id)
           VALUES ($1, $2, $3, 'Extensión QC', $4)`,
          [tenantId, p1Id, FECHA_REANALISIS_1, dtId],
        );

        // Now v_stock_droga must count Partida 1 (50) and still exclude Partida 2 (0)
        const despues = await tx.query(
          `SELECT stock_disponible FROM fsj.v_stock_droga WHERE tenant_id = $1 AND droga_id = $2`,
          [tenantId, drogaId],
        );
        expect(Number(despues.rows[0].stock_disponible)).toBe(50);
      }),
    );
  });
});
