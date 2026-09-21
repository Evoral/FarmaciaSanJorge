/**
 * DB tests for prisma/migrations/*_0007_drogas_proveedores_medicos_pacientes.
 * See tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/designacion-dt.test.ts for the tenant/sistema-user seeding
 * pattern reused here.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";

async function insertTenant(tx: Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function insertUnidad(tx: Client, suffix: string): Promise<string> {
  const codigo = `TEST-UM-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const result = await tx.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, $1, 'x', 'MASA', 1, false) RETURNING id`,
    [codigo],
  );
  return result.rows[0].id as string;
}

async function insertDroga(
  tx: Client,
  tenantId: string,
  unidadBaseId: string,
  overrides: Partial<{ nombre: string; esControlada: boolean; tipoControl: string }> = {},
): Promise<string> {
  const nombre = overrides.nombre ?? `Droga-${randomUUID()}`;
  const result = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, es_controlada, tipo_control)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, nombre, unidadBaseId, overrides.esControlada ?? false, overrides.tipoControl ?? "NINGUNO"],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0007_drogas_proveedores_medicos_pacientes migration (fsj schema)", () => {
  it("droga: es_controlada must match tipo_control <> NINGUNO (check constraint)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg-check");
        const unidadId = await insertUnidad(tx, "drg-check");

        // Each is savepoint-wrapped (via expectDbRejection) so the second
        // insert -- and the successful one after it -- actually run,
        // instead of riding the first insert's aborted transaction.
        await expectDbRejection(
          tx,
          () => insertDroga(tx, tenantId, unidadId, { esControlada: true, tipoControl: "NINGUNO" }),
          "23514",
        );
        await expectDbRejection(
          tx,
          () => insertDroga(tx, tenantId, unidadId, { esControlada: false, tipoControl: "PSICOTROPICO" }),
          "23514",
        );

        const okId = await insertDroga(tx, tenantId, unidadId, { esControlada: true, tipoControl: "ESTUPEFACIENTE" });
        expect(okId).toBeTruthy();
      }),
    );
  });

  it("droga: nombre is unique among vigente (non-baja) rows per tenant, case-insensitive", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg-nombre");
        const unidadId = await insertUnidad(tx, "drg-nombre");
        const nombre = `Ibuprofeno-${randomUUID()}`;

        const id1 = await insertDroga(tx, tenantId, unidadId, { nombre });
        // Savepoint-wrapped (via expectDbRejection) so the baja + re-insert
        // below still runs -- see the aborted-transaction rule in
        // tests/db/helpers.ts.
        await expectDbRejection(
          tx,
          () => insertDroga(tx, tenantId, unidadId, { nombre: nombre.toUpperCase() }),
          "23505",
        );

        // After baja, the name becomes free again.
        await tx.query(`UPDATE fsj.droga SET fecha_baja = now(), motivo_baja = 'discontinuada' WHERE id = $1`, [id1]);
        const id2 = await insertDroga(tx, tenantId, unidadId, { nombre });
        expect(id2).toBeTruthy();
      }),
    );
  });

  it("droga: unidad_base_id must reference an existing unidad_medida", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg-fk");
        await expectDbRejection(tx, () => insertDroga(tx, tenantId, randomUUID()), "23503");
      }),
    );
  });

  it("droga insert marks the referenced unidad_medida as usada (INV-M04 support)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg-usa");
        const unidadId = await insertUnidad(tx, "drg-usa");

        const before = await tx.query(`SELECT usada FROM fsj.unidad_medida WHERE id = $1`, [unidadId]);
        expect(before.rows[0].usada).toBe(false);

        await insertDroga(tx, tenantId, unidadId);

        const after = await tx.query(`SELECT usada FROM fsj.unidad_medida WHERE id = $1`, [unidadId]);
        expect(after.rows[0].usada).toBe(true);

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.unidad_medida SET factor_a_base = 999 WHERE id = $1`, [unidadId]),
          "INV-M04",
        );
      }),
    );
  });

  it("droga: never deleted (INV-F03, generic forbid_delete)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg-del");
        const unidadId = await insertUnidad(tx, "drg-del");
        const id = await insertDroga(tx, tenantId, unidadId);

        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.droga WHERE id = $1`, [id]), "INV-IMMUTABLE");
      }),
    );
  });

  it("droga: no stock column exists on the table (INV-S01)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const columns = await tx.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'fsj' AND table_name = 'droga'`,
        );
        const names = columns.rows.map((r) => r.column_name as string);
        expect(names).not.toContain("stock");
      }),
    );
  });

  it("proveedor: cuit must match the CUIT format (11 digits, optionally hyphenated)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "prov-cuit");

        // Savepoint-wrapped (via expectDbRejection) so the successful
        // insert below still runs -- see the aborted-transaction rule in
        // tests/db/helpers.ts.
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'X', 'not-a-cuit')`, [tenantId]),
          "23514",
        );

        const ok = await tx.query(
          `INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'X', '20-12345678-9') RETURNING id`,
          [tenantId],
        );
        expect(ok.rows).toHaveLength(1);
      }),
    );
  });

  it("proveedor: cuit is unique per tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "prov-uniq");
        await tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'A', '20111111119')`, [
          tenantId,
        ]);
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'B', '20111111119')`, [tenantId]),
          "23505",
        );
      }),
    );
  });

  it("proveedor: never deleted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "prov-del");
        const row = await tx.query(
          `INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'A', '20222222223') RETURNING id`,
          [tenantId],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.proveedor WHERE id = $1`, [row.rows[0].id]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("medico: matricula is unique among vigente rows per tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "med-mat");
        const matricula = `MAT-${randomUUID()}`;

        const row = await tx.query(
          `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'N', 'A', $2) RETURNING id`,
          [tenantId, matricula],
        );
        // Savepoint-wrapped (via expectDbRejection) so the baja + re-insert
        // below still runs -- see the aborted-transaction rule in
        // tests/db/helpers.ts.
        await expectDbRejection(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'N2', 'A2', $2)`, [
              tenantId,
              matricula,
            ]),
          "23505",
        );

        // After baja, the matricula becomes free again.
        await tx.query(`UPDATE fsj.medico SET fecha_baja = now() WHERE id = $1`, [row.rows[0].id]);
        const again = await tx.query(
          `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'N3', 'A3', $2) RETURNING id`,
          [tenantId, matricula],
        );
        expect(again.rows).toHaveLength(1);
      }),
    );
  });

  it("medico: never deleted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "med-del");
        const row = await tx.query(
          `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'N', 'A', $2) RETURNING id`,
          [tenantId, `MAT-${randomUUID()}`],
        );
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.medico WHERE id = $1`, [row.rows[0].id]), "INV-IMMUTABLE");
      }),
    );
  });

  it("paciente: cuil is unique per tenant only when present (NULL allowed multiple times)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-cuil");
        const cuil = "20123456780";

        await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido, cuil) VALUES ($1, 'N', 'A', $2)`, [
          tenantId,
          cuil,
        ]);
        // Savepoint-wrapped (via expectDbRejection) so the NULL-cuil inserts
        // below still run -- see the aborted-transaction rule in
        // tests/db/helpers.ts.
        await expectDbRejection(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido, cuil) VALUES ($1, 'N2', 'A2', $2)`, [
              tenantId,
              cuil,
            ]),
          "23505",
        );

        // Two patients with NULL cuil: both allowed.
        await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'N3', 'A3')`, [tenantId]);
        const second = await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'N4', 'A4') RETURNING id`, [
          tenantId,
        ]);
        expect(second.rows).toHaveLength(1);
      }),
    );
  });

  it("paciente: never deleted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pac-del");
        const row = await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'N', 'A') RETURNING id`, [
          tenantId,
        ]);
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.paciente WHERE id = $1`, [row.rows[0].id]), "INV-IMMUTABLE");
      }),
    );
  });

  it("cross-tenant isolation: fsj_app under tenant A never sees tenant B's droga/proveedor/medico/paciente rows", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "iso-a");
        const tenantB = await insertTenant(tx, "iso-b");
        const unidadId = await insertUnidad(tx, "iso");
        await insertDroga(tx, tenantB, unidadId);
        await tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'B', '20333333335')`, [
          tenantB,
        ]);
        await tx.query(`INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'N', 'A', $2)`, [
          tenantB,
          `MAT-${randomUUID()}`,
        ]);
        await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'N', 'A')`, [tenantB]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantA, async (c) => {
          const drogas = await c.query(`SELECT * FROM fsj.droga`);
          const proveedores = await c.query(`SELECT * FROM fsj.proveedor`);
          const medicos = await c.query(`SELECT * FROM fsj.medico`);
          const pacientes = await c.query(`SELECT * FROM fsj.paciente`);
          expect(drogas.rows).toHaveLength(0);
          expect(proveedores.rows).toHaveLength(0);
          expect(medicos.rows).toHaveLength(0);
          expect(pacientes.rows).toHaveLength(0);
        });
      }),
    );
  });
});
