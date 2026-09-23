/**
 * DB tests for prisma/migrations/.../0034_asiento_recetario_hash_v3 (D4,
 * user decision 2026-09-23). See that migration's header for the full
 * design (version_hash column, detalle_asiento inserted BEFORE its
 * asiento against an app-generated id, the now-DEFERRABLE FK, INV-L22/L23,
 * and fsj.verificar_cadena dispatching per row version).
 *
 * See tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/fixtures.ts for the shared seed helpers (in particular
 * `seedAsientoSistema` and `insertAsientoSistema`, which every test below
 * reuses for a correctly-ordered SISTEMA insert).
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, inSavepoint, expectInvariantViolation } from "./helpers";
import { seedAsientoSistema, insertAsientoSistema, hashV2, type AsientoSistemaResult } from "./fixtures";

/** See tests/db/libro-recetario.test.ts's identical helper for why a NEW ficha_tecnica version is needed (INV-P02: at most one non-DESCARTADA preparacion per ficha_tecnica_id). */
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
  const result = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [seed.tenantId, fichaTecnicaId, seed.sistema],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0034_asiento_recetario_hash_v3 (D4, fsj schema)", () => {
  it("a SISTEMA asiento with NO detalle_asiento row at all is rejected (INV-L22)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "v3NoDetalle");
        const preparacionId = await insertPreparacionAdicional(tx, seed);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_recetario (tenant_id, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
               VALUES ($1, 'SISTEMA', $2, 'Paciente', 'Medico - MAT-1', 'Formula', $3)`,
              [seed.tenantId, preparacionId, seed.sistema],
            ),
          "INV-L22",
        );
      }),
    );
  });

  it("a detalle_asiento cannot be inserted once its asiento_recetario already exists (INV-L23, late insert)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "v3LateDetalle");

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.detalle_asiento (tenant_id, asiento_recetario_id, descripcion, cantidad, unidad_texto, orden)
               VALUES ($1, $2, 'Otra linea tardia', 1, 'g', 1)`,
              // seed.asientoId already exists (seedAsientoSistema).
              [seed.tenantId, seed.asientoId],
            ),
          "INV-L23",
        );
      }),
    );
  });

  it("every asiento inserted through the normal path is version_hash = 3, hashed with fsj.asiento_recetario_hash_v3, and fsj.verificar_cadena reports it intact", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "v3Intacto");

        const row = await tx.query(`SELECT version_hash, hash_integridad, libro_id FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        expect(row.rows[0].version_hash).toBe(3);

        const v3 = await tx.query(`SELECT fsj.asiento_recetario_hash_v3(a) AS h FROM fsj.asiento_recetario a WHERE id = $1`, [seed.asientoId]);
        expect(row.rows[0].hash_integridad).toBe(v3.rows[0].h);

        const verif = await tx.query(`SELECT fsj.verificar_cadena($1, $2) AS roto`, [seed.tenantId, row.rows[0].libro_id]);
        expect(verif.rows[0].roto).toBeNull();
      }),
    );
  });

  it("fsj.verificar_cadena detects a tampered detalle_asiento line (V3 -- the gap V2 could not see)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "v3TamperDetalle");
        const libro = await tx.query(`SELECT libro_id FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const libroId = libro.rows[0].libro_id as string;

        const verificar = async () => String((await tx.query(`SELECT fsj.verificar_cadena($1, $2) AS roto`, [seed.tenantId, libroId])).rows[0].roto);
        expect(await verificar()).toBe("null");

        // Tamper the LINE (not the asiento row itself) -- detalle_asiento has
        // no UPDATE grant either (immutable), so simulate raw storage access
        // the same way tests/db/libro-recetario.test.ts's own tampering test
        // does: session_replication_role bypasses ordinary triggers, inside
        // a savepoint that inSavepoint ALWAYS rolls back, inside
        // inRollbackTx (nothing here ever persists).
        await inSavepoint(tx, async () => {
          await tx.query(`SET LOCAL session_replication_role = replica`);
          await tx.query(`UPDATE fsj.detalle_asiento SET cantidad = 999 WHERE asiento_recetario_id = $1`, [seed.asientoId]);
          await tx.query(`SET LOCAL session_replication_role = origin`);

          // hash_integridad was computed from the ORIGINAL cantidad --
          // fsj.asiento_recetario_hash_v3 now recomputes over the TAMPERED
          // line and no longer matches: the asiento itself is flagged.
          const numeroCorrelativo = (await tx.query(`SELECT numero_correlativo::text AS n FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]))
            .rows[0].n as string;
          expect(await verificar()).toBe(numeroCorrelativo);
        });

        // Everything above was rolled back: intact again.
        expect(await verificar()).toBe("null");
      }),
    );
  });

  it("a mixed V2/V3 chain verifies OK -- a legacy V2 row followed by a real V3 insert", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "v3Mixto");
        const libro = await tx.query(`SELECT libro_id FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const libroId = libro.rows[0].libro_id as string;

        // Simulate a PRE-migration-0034 SECOND row: version_hash = 2,
        // hashed with the V2 algorithm, inserted bypassing the (now
        // V3-only) trigger, chained after seed's own (real, V3) asiento.
        const seedRow = await tx.query(`SELECT hash_integridad FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const hashAnteriorV2 = seedRow.rows[0].hash_integridad as string;

        const prep2 = await insertPreparacionAdicional(tx, seed);
        const asientoV2Id = randomUUID();
        const fechaAsientoRow = await tx.query(`SELECT fsj.jornada_actual($1)::text AS f`, [seed.tenantId]);
        const fechaAsiento = fechaAsientoRow.rows[0].f as string;
        const v2Hash = hashV2([
          "FSJ-ASIENTO-V2",
          seed.tenantId,
          libroId,
          "2",
          fechaAsiento,
          "SISTEMA",
          prep2,
          null,
          "Paciente",
          "Medico - MAT-1",
          "Formula legacy V2",
          hashAnteriorV2,
        ]);

        await tx.query(`SET LOCAL session_replication_role = replica`);
        await tx.query(
          `INSERT INTO fsj.asiento_recetario (id, tenant_id, libro_id, numero_correlativo, fecha_asiento, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, version_hash, estado, hash_integridad, hash_anterior, registrado_por_id)
           VALUES ($1, $2, $3, 2, $4, 'SISTEMA', $5, 'Paciente', 'Medico - MAT-1', 'Formula legacy V2', 2, 'VIGENTE', $6, $7, $8)`,
          [asientoV2Id, seed.tenantId, libroId, fechaAsiento, prep2, v2Hash, hashAnteriorV2, seed.sistema],
        );
        // Keep the counter consistent with the manually-inserted row (the
        // trigger that normally does this was bypassed above).
        await tx.query(`UPDATE fsj.contador_correlativo SET ultimo_valor = 2, ultimo_hash = $1 WHERE tenant_id = $2 AND libro_id = $3`, [
          v2Hash,
          seed.tenantId,
          libroId,
        ]);
        await tx.query(`SET LOCAL session_replication_role = origin`);

        // A REAL V3 insert follows normally, chaining hash_anterior to the legacy V2 row.
        const prep3 = await insertPreparacionAdicional(tx, seed);
        const asiento3 = await insertAsientoSistema(tx, { tenantId: seed.tenantId, preparacionId: prep3, registradoPorId: seed.sistema });
        expect(asiento3.hashAnterior).toBe(v2Hash);
        expect(asiento3.numeroCorrelativo).toBe("3");

        const verif = await tx.query(`SELECT fsj.verificar_cadena($1, $2) AS roto`, [seed.tenantId, libroId]);
        expect(verif.rows[0].roto).toBeNull();
      }),
    );
  });
});
