/**
 * FASE 10, M13a point 10.5: concurrency of firma. Two REAL, separate
 * connections calling `fsj.cierre_diario_firmar` for the same fecha (one
 * wins, the other is rejected with INV-C01), and for consecutive fechas
 * signed out of order.
 *
 * HONEST SCOPE (same technique and same limitation as
 * tests/db/preparaciones-confirmar.test.ts's own concurrency test -- read
 * that file's comment for the full argument): a genuine two-connection race
 * where BOTH transactions attempt `fsj.cierre_diario_firmar` at the same
 * instant and one is forced to wait on the tenant-scoped advisory lock
 * (`pg_advisory_xact_lock(hashtext(tenant_id::text))`, taken by the
 * function itself) would require the FIRST transaction to actually COMMIT
 * before the second can proceed past the lock -- and this harness has only
 * ONE shared real Supabase database (no disposable test project yet), so a
 * committed cierre_diario/asiento_recetario row would be stuck there
 * permanently. This file instead:
 *
 *   1. Proves the exact serialization mechanism (two real connections,
 *      the SAME tenant-scoped advisory lock `fsj.cierre_diario_firmar`
 *      itself takes) actually blocks a second connection until the first's
 *      transaction ends -- zero DDL, zero committed rows, both roll back.
 *   2. Proves the "one wins, the other loses with INV-C01" and "chronological
 *      order" outcomes with two SEQUENTIAL calls inside ONE rolled-back
 *      transaction (`inRollbackTx`/`inSavepoint`) -- this is exactly what
 *      would happen to the second connection in (1) once it acquires the
 *      lock after the first commits: it re-runs the SAME checks the
 *      sequential test exercises here, so this is the real invariant, only
 *      demonstrated without a second physical connection.
 */
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, setRelojPrueba } from "./helpers";
import { createUserWithRole, designarDt, seedAsientoSistema, insertAsientoSistema, type AsientoSistemaResult } from "./fixtures";

async function crearDtVigente(tx: Client, seed: { tenantId: string; sistema: string }, vigenteDesde = "2000-01-01") {
  const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dtconc");
  const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema, vigenteDesde);
  return { dtId, designacionId };
}

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
  const result = await tx.query(`INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`, [
    seed.tenantId,
    fichaTecnicaId,
    seed.sistema,
  ]);
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("FASE 10 point 10.5: cierre diario firma -- cross-connection lock serialization", () => {
  it("two real connections calling pg_advisory_xact_lock(hashtext(tenant_id::text)) (the exact lock fsj.cierre_diario_firmar takes) serialize: the second blocks until the first's transaction ends", async () => {
    const { directUrl } = requireDbTestEnv();
    const a = new (await import("pg")).Client({ connectionString: directUrl });
    const b = new (await import("pg")).Client({ connectionString: directUrl });
    await a.connect();
    await b.connect();
    const tenantIdLike = "00000000-0000-4000-8000-000000000001"; // fixed value -- only the lock key matters here, no real tenant needed.
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      await a.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [tenantIdLike]);

      const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      let bAcquired = false;
      const bPromise = b.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [tenantIdLike]).then(() => {
        bAcquired = true;
      });

      let bWaiting = false;
      for (let i = 0; i < 50 && !bWaiting; i++) {
        const w = await a.query(`SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`, [bPid]);
        bWaiting = w.rows[0].n > 0;
        if (!bWaiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(bWaiting, "connection B never showed up as waiting on the advisory lock").toBe(true);
      expect(bAcquired).toBe(false);

      // Releasing A's lock (via ROLLBACK, so nothing is ever committed) lets B proceed.
      await a.query("ROLLBACK");
      await bPromise;
      expect(bAcquired).toBe(true);
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      await b.query("ROLLBACK").catch(() => undefined);
      await a.end();
      await b.end();
    }
  });
});

describe.skipIf(dbTestSkipReason() !== null)("FASE 10 point 10.5: cierre diario firma -- outcomes (sequential, same invariant a serialized second connection would hit)", () => {
  it("same fecha: the FIRST firmar wins, the SECOND (whether from another connection or, as here, sequentially in the same tx) loses with INV-C01", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "concc01");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        const first = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4)`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(first.rows[0].id).toBeTruthy();

        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-C01",
        );
      }),
    );
  });

  it("consecutive fechas signed OUT OF ORDER: the later one is rejected with INV-C19 until the earlier one is signed first", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "concc19");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fechaD = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");
        const asiento2 = await insertPreparacionAdicional(tx, seed);
        const insertResult = await insertAsientoSistema(tx, {
          tenantId: seed.tenantId,
          preparacionId: asiento2,
          registradoPorId: seed.sistema,
          pacienteTexto: "Paciente",
          medicoTexto: "Medico - MAT-1",
          formulaTexto: "Formula",
        });
        const fechaD1 = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [insertResult.id]);
        expect(fechaD1.rows[0].fecha_asiento > fechaD.rows[0].fecha_asiento).toBe(true);

        // Attempting D+1 first (out of order) is rejected -- D still has unsigned asientos.
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4, 'FALLA_SISTEMA', NULL)`, [
            seed.tenantId,
            fechaD1.rows[0].fecha_asiento,
            dtId,
            designacionId,
          ]),
          "INV-C19",
        );

        // Signing D first (in order) works.
        const cierreD = await tx.query(`SELECT id FROM fsj.cierre_diario_firmar($1, $2, $3, $4, 'FALLA_SISTEMA', NULL)`, [
          seed.tenantId,
          fechaD.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(cierreD.rows[0].id).toBeTruthy();

        // Now D+1 can be signed.
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
});
