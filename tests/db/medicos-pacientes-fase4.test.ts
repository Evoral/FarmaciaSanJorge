/**
 * DB tests for migration 0029 (FASE 4 points 4.4/4.5: médicos, pacientes).
 * Read tests/db/catalogos-negocio.test.ts (migration 0007) and
 * tests/db/catalogos-fase4.test.ts (migration 0027, the proveedor
 * equivalent of this file) FIRST -- this file does NOT duplicate:
 *   - médico matrícula uniqueness among vigente rows, and that it is freed
 *     after baja (catalogos-negocio.test.ts, "medico: matricula is unique
 *     among vigente rows per tenant").
 *   - médico/paciente never deleted (catalogos-negocio.test.ts).
 *   - paciente cuil uniqueness when present / NULL allowed multiple times
 *     (catalogos-negocio.test.ts, "paciente: cuil is unique per tenant
 *     only when present").
 *   - cross-tenant isolation for medico/paciente (catalogos-negocio.test.ts).
 *
 * What THIS file adds:
 *   1. migration 0029: fsj.medico and fsj.paciente both have a motivo_baja
 *      column, and fsj_app can set it (baja) and clear it back to NULL
 *      (reactivación) -- neither table's reactivación path was previously
 *      exercised.
 *   2. paciente_cuil_formato_check / paciente_dni_formato_check (migration
 *      0029) reject a non-normalized value with 23514 -- these CHECKs did
 *      not exist before this migration.
 *   3. paciente cuil uniqueness SURVIVES baja -- unlike médico's matrícula
 *      (uq_medico_matricula_vigente is a PARTIAL index, WHERE fecha_baja IS
 *      NULL), uq_paciente_cuil (migration 0007) has no such WHERE clause,
 *      so a cuil can never be reused by a different paciente even after
 *      the original is given de baja. catalogos-negocio.test.ts's cuil
 *      test never gives a row de baja, so this specific behavior was
 *      untested until now.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectDbRejection } from "./helpers";

async function insertTenant(tx: Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("FASE 4 points 4.4/4.5 additions to migration 0029 (medico/paciente)", () => {
  it("migration 0029: fsj.medico and fsj.paciente both have a motivo_baja column", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const medicoColumns = await tx.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'fsj' AND table_name = 'medico'`,
        );
        expect(medicoColumns.rows.map((r) => r.column_name as string)).toContain("motivo_baja");

        const pacienteColumns = await tx.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'fsj' AND table_name = 'paciente'`,
        );
        expect(pacienteColumns.rows.map((r) => r.column_name as string)).toContain("motivo_baja");
      }),
    );
  });

  it("medico: fsj_app can set fecha_baja + motivo_baja (baja) and clear both back to NULL (reactivación)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "med-motivo");
        const row = await tx.query(
          `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'N', 'A', $2) RETURNING id`,
          [tenantId, `MAT-${randomUUID()}`],
        );
        const medicoId = row.rows[0].id as string;

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

        await tx.query(`UPDATE fsj.medico SET fecha_baja = now(), motivo_baja = 'Jubilación' WHERE id = $1`, [medicoId]);
        const afterBaja = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.medico WHERE id = $1`, [medicoId]);
        expect(afterBaja.rows[0].fecha_baja).not.toBeNull();
        expect(afterBaja.rows[0].motivo_baja).toBe("Jubilación");

        await tx.query(`UPDATE fsj.medico SET fecha_baja = NULL, motivo_baja = NULL WHERE id = $1`, [medicoId]);
        const afterReactivacion = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.medico WHERE id = $1`, [medicoId]);
        expect(afterReactivacion.rows[0].fecha_baja).toBeNull();
        expect(afterReactivacion.rows[0].motivo_baja).toBeNull();
      }),
    );
  });

  it("paciente: fsj_app can set fecha_baja + motivo_baja (baja) and clear both back to NULL (reactivación)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-motivo");
        const row = await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'N', 'A') RETURNING id`, [
          tenantId,
        ]);
        const pacienteId = row.rows[0].id as string;

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

        await tx.query(`UPDATE fsj.paciente SET fecha_baja = now(), motivo_baja = 'Solicitud del paciente' WHERE id = $1`, [
          pacienteId,
        ]);
        const afterBaja = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.paciente WHERE id = $1`, [pacienteId]);
        expect(afterBaja.rows[0].fecha_baja).not.toBeNull();
        expect(afterBaja.rows[0].motivo_baja).toBe("Solicitud del paciente");

        await tx.query(`UPDATE fsj.paciente SET fecha_baja = NULL, motivo_baja = NULL WHERE id = $1`, [pacienteId]);
        const afterReactivacion = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.paciente WHERE id = $1`, [pacienteId]);
        expect(afterReactivacion.rows[0].fecha_baja).toBeNull();
        expect(afterReactivacion.rows[0].motivo_baja).toBeNull();
      }),
    );
  });

  it("paciente_cuil_formato_check (migration 0029): a value that is not exactly 11 digits is rejected with 23514", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-cuil-check");
        // NOTE: a DASHED value like "20-12345678-6" (13 chars) cannot be used
        // here -- fsj.paciente.cuil is `varchar(11)` (migration 0007), so
        // Postgres rejects anything over 11 characters with 22001 (string
        // data right truncation) BEFORE the CHECK constraint ever runs. "10
        // plain digits" (no separator) fits the column exactly and isolates
        // the CHECK itself: not-exactly-11-digits, cleanly.
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido, cuil) VALUES ($1, 'N', 'A', '2012345678')`, [tenantId]),
          "23514",
        );
      }),
    );
  });

  it("paciente_cuil_formato_check: a valid, already-normalized 11-digit cuil is accepted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-cuil-ok");
        const row = await tx.query(
          `INSERT INTO fsj.paciente (tenant_id, nombre, apellido, cuil) VALUES ($1, 'N', 'A', '20123456786') RETURNING id`,
          [tenantId],
        );
        expect(row.rows).toHaveLength(1);
      }),
    );
  });

  it("paciente_dni_formato_check (migration 0029): a dotted DNI is rejected with 23514", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-dni-check");
        // NOTE: "30.123.456" (10 chars) does not fit either -- fsj.paciente.dni
        // is `varchar(8)` (migration 0007), so that literal hits the SAME
        // 22001 column-length truncation as the cuil case above, before the
        // CHECK runs. "3012.456" is 8 characters (fits the column exactly)
        // and still contains a non-digit, isolating the CHECK.
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni) VALUES ($1, 'N', 'A', '3012.456')`, [tenantId]),
          "23514",
        );
      }),
    );
  });

  it("paciente_dni_formato_check: a DNI with fewer than 7 digits is rejected with 23514", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-dni-len");
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni) VALUES ($1, 'N', 'A', '123456')`, [tenantId]),
          "23514",
        );
      }),
    );
  });

  it("fsj.paciente.dni's varchar(8) column length ALREADY rejects more than 8 digits (22001) before the CHECK's own upper bound would ever be reached -- documents that migration 0029's CHECK upper bound is a belt-and-suspenders, not the primary enforcement, for this specific case", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-dni-toolong");
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni) VALUES ($1, 'N', 'A', '123456789')`, [tenantId]),
          "22001",
        );
      }),
    );
  });

  it("paciente_dni_formato_check: 7 and 8 plain digits are both accepted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-dni-ok");
        const seven = await tx.query(
          `INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni) VALUES ($1, 'N', 'A', '4123456') RETURNING id`,
          [tenantId],
        );
        expect(seven.rows).toHaveLength(1);

        const eight = await tx.query(
          `INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni) VALUES ($1, 'N2', 'A2', '30123456') RETURNING id`,
          [tenantId],
        );
        expect(eight.rows).toHaveLength(1);
      }),
    );
  });

  it("paciente: cuil uniqueness SURVIVES baja -- a different paciente cannot reuse a cuil even after the original is given de baja (uq_paciente_cuil has no partial WHERE, unlike medico's matricula index)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-cuil-survives-baja");
        const cuil = "20123456786";

        const original = await tx.query(
          `INSERT INTO fsj.paciente (tenant_id, nombre, apellido, cuil) VALUES ($1, 'N', 'A', $2) RETURNING id`,
          [tenantId, cuil],
        );

        await tx.query(`UPDATE fsj.paciente SET fecha_baja = now(), motivo_baja = 'Duplicado' WHERE id = $1`, [original.rows[0].id]);

        // Even though the original paciente is now de baja, the SAME cuil
        // still cannot be reused by a different paciente -- this is what
        // "survives baja" means, unlike medico.matricula (freed after baja).
        await expectDbRejection(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido, cuil) VALUES ($1, 'N2', 'A2', $2)`, [tenantId, cuil]),
          "23505",
        );
      }),
    );
  });

  it("medico/paciente motivo_baja is not a broad grant -- tenant_id remains NEVER grant-updatable by fsj_app (INV-T03 sanity check)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "med-pac-grant");
        const medico = await tx.query(
          `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'N', 'A', $2) RETURNING id`,
          [tenantId, `MAT-${randomUUID()}`],
        );
        const paciente = await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'N', 'A') RETURNING id`, [
          tenantId,
        ]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.medico SET tenant_id = $1 WHERE id = $2`, [randomUUID(), medico.rows[0].id]),
          "42501",
        );
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.paciente SET tenant_id = $1 WHERE id = $2`, [randomUUID(), paciente.rows[0].id]),
          "42501",
        );
      }),
    );
  });
});
