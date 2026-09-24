/**
 * DB tests for prisma/migrations/.../0015_cierre_diario (M13a). See
 * tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/fixtures.ts for the shared seed helpers. A second, strictly-later
 * jornada is obtained by pinning explicit instants via `setRelojPrueba`
 * (prisma/migrations/.../0024_jornada_reloj_de_prueba) rather than waiting
 * for real time to pass -- see tests/db/helpers.ts#setRelojPrueba for why
 * (replaces a zona_horaria-jump technique that used to be here and was
 * non-deterministic near UTC day boundaries).
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection, setRelojPrueba } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  crearLibrosRubricados,
  createUserWithRole,
  designarDt,
  seedAsientoSistema,
  insertAsientoSistema,
  hashV2,
  type AsientoSistemaResult,
} from "./fixtures";

/** See tests/db/libro-recetario.test.ts's identical helper for why a NEW ficha_tecnica version is needed (INV-P02). */
async function insertPreparacionAdicional(tx: Client, seed: AsientoSistemaResult): Promise<string> {
  const versionResult = await tx.query(
    `SELECT coalesce(max(version), 0) + 1 AS next FROM fsj.ficha_tecnica WHERE tenant_id = $1 AND item_receta_id = $2`,
    [seed.tenantId, seed.itemRecetaId],
  );
  const version = versionResult.rows[0].next as number;
  const fichaResult = await tx.query(
    `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [seed.tenantId, seed.itemRecetaId, version, seed.sistema],
  );
  const fichaTecnicaId = fichaResult.rows[0].id as string;
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

async function insertAsientoSistemaAdicional(tx: Client, seed: AsientoSistemaResult): Promise<string> {
  const preparacionId = await insertPreparacionAdicional(tx, seed);
  const result = await insertAsientoSistema(tx, {
    tenantId: seed.tenantId,
    preparacionId,
    registradoPorId: seed.sistema,
    pacienteTexto: "Paciente",
    medicoTexto: "Medico - MAT-1",
    formulaTexto: "Formula",
  });
  return result.id;
}

async function crearDtVigente(tx: Client, seed: AsientoSistemaResult, vigenteDesde = "2000-01-01"): Promise<{ dtId: string; designacionId: string }> {
  const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dt");
  const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema, vigenteDesde);
  return { dtId, designacionId };
}

describe.skipIf(dbTestSkipReason() !== null)("0015_cierre_diario migration (fsj schema)", () => {
  it("firmar links EVERY VIGENTE asiento_recetario of the jornada, and returns a cierre with correct cantidad_asientos/hash_lote", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "firma");
        const asiento2 = await insertAsientoSistemaAdicional(tx, seed);
        const { dtId, designacionId } = await crearDtVigente(tx, seed);

        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const hashes = await tx.query(
          `SELECT hash_integridad FROM fsj.asiento_recetario WHERE tenant_id = $1 AND fecha_asiento = $2 ORDER BY numero_correlativo`,
          [seed.tenantId, fecha.rows[0].fecha_asiento],
        );

        const cierre = await tx.query(`SELECT * FROM fsj.cierre_diario_firmar($1, $2, $3, $4, NULL, NULL)`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(cierre.rows[0].cantidad_asientos).toBe(2);
        expect(cierre.rows[0].fuera_de_termino).toBe(false);
        expect(cierre.rows[0].version_formato).toBe(2);

        // hash_lote V2 (migration 0018 header), recomputed in Node from the spec:
        // tag, tenant_id, fecha, N, recetario hashes..., M, contralor hashes...
        const recetarioHashes = hashes.rows.map((r) => r.hash_integridad as string);
        expect(cierre.rows[0].hash_lote).toBe(
          hashV2(["FSJ-CIERRE-V2", seed.tenantId, fecha.rows[0].fecha_asiento, String(recetarioHashes.length), ...recetarioHashes, "0"]),
        );

        const linked = await tx.query(
          `SELECT id, cierre_diario_id FROM fsj.asiento_recetario WHERE id = ANY($1)`,
          [[seed.asientoId, asiento2]],
        );
        for (const row of linked.rows) {
          expect(row.cierre_diario_id).toBe(cierre.rows[0].id);
        }
      }),
    );
  });

  it("firmar also links every VIGENTE asiento_contralor of the jornada (INV-C02 applies to the contralor too)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "firmaContralor");
        const sistema = await createSistemaUser(tx, tenantId);
          await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadResult = await tx.query(
          `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base) VALUES ($1,$1,'x','MASA',1,false) RETURNING id`,
          [`UM-FC-${randomUUID()}`],
        );
        const unidadId = unidadResult.rows[0].id as string;
        const drogaResult = await tx.query(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, es_controlada, tipo_control) VALUES ($1,$2,$3,true,'PSICOTROPICO') RETURNING id`,
          [tenantId, `Droga-${randomUUID()}`, unidadId],
        );
        const drogaId = drogaResult.rows[0].id as string;
        await tx.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = now() - interval '1 day' WHERE id = $1`, [tenantId]);

        const apertura = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'D', 100, $3, $4) RETURNING id, fecha_asiento::text`,
          [tenantId, drogaId, unidadId, sistema],
        );

        const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "firmaContralor");
        const { designacionId } = await designarDt(tx, tenantId, dtId, sistema);

        const cierre = await tx.query(`SELECT * FROM fsj.cierre_diario_firmar($1, $2, $3, $4, NULL, NULL)`, [
          tenantId,
          apertura.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);

        const linked = await tx.query(`SELECT cierre_diario_id, hash_integridad FROM fsj.asiento_contralor WHERE id = $1`, [
          apertura.rows[0].id,
        ]);
        expect(linked.rows[0].cierre_diario_id).toBe(cierre.rows[0].id);

        // hash_lote V2 also seals the linked contralor asiento (N=0 recetario, M=1 contralor).
        expect(cierre.rows[0].cantidad_asientos).toBe(0);
        expect(cierre.rows[0].hash_lote).toBe(
          hashV2(["FSJ-CIERRE-V2", tenantId, apertura.rows[0].fecha_asiento, "0", "1", linked.rows[0].hash_integridad]),
        );
      }),
    );
  });

  it("M2 / INV-C19: an earlier jornada with ONLY contralor movements (no recetario asiento) blocks signing a later one, and signing it links them", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "c19contralor");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const unidadResult = await tx.query(
          `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base) VALUES ($1,$1,'x','MASA',1,false) RETURNING id`,
          [`UM-C19C-${randomUUID()}`],
        );
        const unidadId = unidadResult.rows[0].id as string;
        const drogaResult = await tx.query(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, es_controlada, tipo_control) VALUES ($1,$2,$3,true,'PSICOTROPICO') RETURNING id`,
          [tenantId, `Droga-${randomUUID()}`, unidadId],
        );
        await tx.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = now() - interval '1 day' WHERE id = $1`, [tenantId]);
        const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "c19contralor");
        const { designacionId } = await designarDt(tx, tenantId, dtId, sistema);

        // Day D: ONLY a contralor movement.
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const apertura = await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
           VALUES ($1, 'APERTURA', $2, 'D', 100, $3, $4) RETURNING id, fecha_asiento::text`,
          [tenantId, drogaResult.rows[0].id, unidadId, sistema],
        );
        const fechaD = apertura.rows[0].fecha_asiento as string;
        const recetarioD = await tx.query(`SELECT count(*)::int AS n FROM fsj.asiento_recetario WHERE tenant_id = $1`, [tenantId]);
        expect(recetarioD.rows[0].n).toBe(0);

        // Day D+1.
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");
        const fechaD1 = (await tx.query(`SELECT fsj.jornada_actual($1)::text AS j`, [tenantId])).rows[0].j as string;
        expect(fechaD1 > fechaD).toBe(true);

        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [tenantId, fechaD1, dtId, designacionId]),
          "INV-C19",
        );

        // Signing D first works (late -> motivo required, INV-C18) and links the contralor row.
        const cierreD = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4, 'FALLA_SISTEMA', NULL)`, [
          tenantId,
          fechaD,
          dtId,
          designacionId,
        ]);
        const linked = await tx.query(`SELECT cierre_diario_id FROM fsj.asiento_contralor WHERE id = $1`, [apertura.rows[0].id]);
        expect(linked.rows[0].cierre_diario_id).toBe(cierreD.rows[0].id);

        // Now D+1 can be signed.
        const cierreD1 = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4)`, [tenantId, fechaD1, dtId, designacionId]);
        expect(cierreD1.rows[0].id).toBeTruthy();
      }),
    );
  });

  it("INV-C03: a movimiento_stock dated into an already-signed jornada is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "c03");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
               VALUES ($1, $2, 'INGRESO_COMPRA', 1, $3)`,
              [seed.tenantId, seed.partidaId, seed.sistema],
            ),
          "INV-C03",
        );
      }),
    );
  });

  it("INV-C01: signing the same fecha twice is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "c01");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]);

        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-C01",
        );
      }),
    );
  });

  it("INV-C19: signing out of chronological order is rejected -- an earlier unsigned jornada blocks signing a later one", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "c19");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fechaD = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        // Move forward and create a SECOND, later jornada's asiento -- day D stays unsigned.
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");
        const asiento2 = await insertAsientoSistemaAdicional(tx, seed);
        const fechaD1 = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [asiento2]);
        expect(fechaD1.rows[0].fecha_asiento > fechaD.rows[0].fecha_asiento).toBe(true);

        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fechaD1.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-C19",
        );

        // Signing D FIRST works. By now the tenant's CURRENT jornada is
        // already D+1 (we jumped forward to create asiento2), so signing D
        // at this point is ALSO fuera_de_termino (INV-C18) -- realistically
        // correct (signing "yesterday" today is late) and orthogonal to
        // what THIS test checks (chronological order), so a motivo is
        // supplied here; INV-C18 has its own dedicated test above.
        const cierreD = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4, $5, NULL)`, [
          seed.tenantId,
          fechaD.rows[0].fecha_asiento,
          dtId,
          designacionId,
          "FALLA_SISTEMA",
        ]);
        expect(cierreD.rows[0].id).toBeTruthy();

        // Now D+1 can be signed. It will be reported fuera_de_termino (D
        // already passed) -- see the dedicated INV-C18 test below for that
        // requirement; pass a motivo here so this test stays focused on C19.
        const cierreD1 = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4, 'FALLA_SISTEMA', NULL)`, [
          seed.tenantId,
          fechaD1.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(cierreD1.rows[0].id).toBeTruthy();
      }),
    );
  });

  it("INV-C18: signing a jornada that has already passed (fuera_de_termino) requires motivo_demora", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "c18");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        // Move "now" forward so `fecha` is now in the past.
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-C18",
        );

        const cierre = await tx.query(`SELECT fuera_de_termino, motivo_demora FROM fsj.cierre_diario_firmar($1, $2, $3, $4, $5, NULL)`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
          "FALLA_SISTEMA",
        ]);
        expect(cierre.rows[0].fuera_de_termino).toBe(true);
        expect(cierre.rows[0].motivo_demora).toBe("FALLA_SISTEMA");
      }),
    );
  });

  it("INV-U04: a non-DT user, or a DT designacion that does not cover cierre.fecha, is rejected as signer", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "u04");
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        // Non-DT user entirely.
        const noDt = await createUserWithRole(tx, seed.tenantId, "FARMACEUTICO", seed.sistema, "u04nodt");
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, noDt, randomUUID()]),
          "INV-U04",
        );

        // A DT designacion that does NOT cover cierre.fecha (vigente_desde is TOMORROW relative to fecha).
        const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "u04dt");
        const future = await tx.query(`SELECT ($1::date + 1)::text AS f`, [fecha.rows[0].fecha_asiento]);
        const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema, future.rows[0].f);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-U04",
        );
      }),
    );
  });

  it("INV-U04 (migration 0022, FASE 3 point 3.9 M1): signing as a SUSPENDIDO DT (a vigente designation, but not ACTIVO) is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "u04susp");
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        // Designate while ACTIVO (INV-DT-005 requires ACTIVO at INSERT
        // time -- a SUSPENDIDO user could never even be designated), THEN
        // suspend (a valid ACTIVO -> SUSPENDIDO transition, INV-USR-006).
        // The designation itself is untouched and still covers fecha --
        // before migration 0022 this was accepted regardless, since
        // cierre_diario_firmar's own INV-U04 query only checked the
        // designation period, never usuario.estado.
        const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "u04susp");
        const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema);
        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [dtId]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-U04",
        );
      }),
    );
  });

  it("cierre_diario is immutable except fecha_impresion/impreso_por_id (INV-C04)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "c04");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const cierre = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4)`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        const cierreId = cierre.rows[0].id as string;

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.cierre_diario SET cantidad_asientos = 999 WHERE id = $1`, [cierreId]),
          "INV-C04",
        );

        // The allowed mutation works, and fsj_app has the grant for it.
        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [seed.tenantId]);
        await tx.query(`UPDATE fsj.cierre_diario SET fecha_impresion = now(), impreso_por_id = $1 WHERE id = $2`, [seed.sistema, cierreId]);
        const printed = await tx.query(`SELECT fecha_impresion FROM fsj.cierre_diario WHERE id = $1`, [cierreId]);
        expect(printed.rows[0].fecha_impresion).not.toBeNull();

        // fsj_app has NO INSERT/DELETE grant on cierre_diario at all.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.cierre_diario (tenant_id, fecha, director_tecnico_id, designacion_id, matricula_dt, cantidad_asientos, hash_lote, fuera_de_termino)
               VALUES ($1, current_date, $2, $3, 'X', 0, 'x', false)`,
              [seed.tenantId, dtId, designacionId],
            ),
          "42501",
        );
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.cierre_diario WHERE id = $1`, [cierreId]), "42501");
      }),
    );
  });
});
