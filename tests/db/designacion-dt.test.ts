/**
 * DB tests for prisma/migrations/*_0005_designacion_director_tecnico.
 * See tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/tenant-parametro.test.ts for the `SET LOCAL ROLE fsj_app`
 * technique used by the fsj.es_dt_vigente() tests (RLS-dependent function).
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

async function createSistemaUser(tx: Client, tenantId: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
     VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
    [id, tenantId, `sistema+${id}@internal.local`, `SISTEMA-${id}`],
  );
  const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'SISTEMA'`);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRol.rows[0].id,
  ]);
  return id;
}

async function createUserWithRole(
  tx: Client,
  tenantId: string,
  rolCodigo: string,
  sistema: string,
  suffix: string,
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, `${suffix}-${Date.now()}@example.com`, `DNI-${suffix}-${Date.now()}`, sistema],
  );
  const rol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = $1`, [rolCodigo]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rol.rows[0].id,
    sistema,
  ]);
  return id;
}

describe.skipIf(dbTestSkipReason() !== null)("0005_designacion_director_tecnico migration (fsj schema)", () => {
  it("INV-DT-001: designating a user without role DIRECTOR_TECNICO is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt001a");
        const sistema = await createSistemaUser(tx, tenantId);
        const farmaceutico = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "far");

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
               VALUES ($1, $2, 'TITULAR', 'MAT-1', '2026-01-01', $3)`,
              [tenantId, farmaceutico, sistema],
            ),
          "INV-DT-001",
        );
      }),
    );
  });

  it("INV-DT-001: designating a user WITH role DIRECTOR_TECNICO succeeds", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt001b");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt");

        const result = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-2', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        expect(result.rows).toHaveLength(1);
      }),
    );
  });

  it("INV-DT-002: two overlapping TITULAR periods in the same tenant are rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt002");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt1 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt1");
        const dt2 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt2");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-A', '2026-01-01', '2026-06-30', $3)`,
          [tenantId, dt1, sistema],
        );
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
               VALUES ($1, $2, 'TITULAR', 'MAT-B', '2026-06-01', '2026-12-31', $3)`,
              [tenantId, dt2, sistema],
            ),
          "23P01",
        );
      }),
    );
  });

  it("INV-DT-002: back-to-back (non-overlapping) TITULAR periods are allowed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt002b");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt1 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt1b");
        const dt2 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt2b");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-C', '2026-01-01', '2026-05-31', $3)`,
          [tenantId, dt1, sistema],
        );
        // Starts the day after the previous one ends -- no overlap.
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-D', '2026-06-01', '2026-12-31', $3)`,
          [tenantId, dt2, sistema],
        );
      }),
    );
  });

  it("DP-11: overlapping SUPLENTE periods are NOT constrained (only TITULAR is)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt011");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt1 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "sup1");
        const dt2 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "sup2");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'SUPLENTE', 'MAT-E', '2026-01-01', '2026-12-31', $3)`,
          [tenantId, dt1, sistema],
        );
        // Fully overlapping SUPLENTE period -- must succeed (DP-11 pending).
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'SUPLENTE', 'MAT-F', '2026-01-01', '2026-12-31', $3)`,
          [tenantId, dt2, sistema],
        );
      }),
    );
  });

  it("INV-DT-002: overlapping TITULAR periods in DIFFERENT tenants are allowed (exclusion is per-tenant)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "dt002cA");
        const tenantB = await insertTenant(tx, "dt002cB");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const sistemaB = await createSistemaUser(tx, tenantB);
        const dtA = await createUserWithRole(tx, tenantA, "DIRECTOR_TECNICO", sistemaA, "dtA");
        const dtB = await createUserWithRole(tx, tenantB, "DIRECTOR_TECNICO", sistemaB, "dtB");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-G', '2026-01-01', '2026-12-31', $3)`,
          [tenantA, dtA, sistemaA],
        );
        // Same dates, different tenant -- must succeed.
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-H', '2026-01-01', '2026-12-31', $3)`,
          [tenantB, dtB, sistemaB],
        );
      }),
    );
  });

  it("INV-DT-003: vigente_desde and matricula are immutable", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt003");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt003");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-I', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        const id = row.rows[0].id;

        // Each violation is wrapped in its own savepoint (via
        // expectInvariantViolation) so the second assertion below actually
        // exercises the matricula immutability check, instead of just
        // observing the first violation's aborted transaction -- see the
        // aborted-transaction rule in tests/db/helpers.ts.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET vigente_desde = '2026-02-01' WHERE id = $1`, [id]),
          "INV-DT-003",
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET matricula = 'MAT-CHANGED' WHERE id = $1`, [id]),
          "INV-DT-003",
        );
      }),
    );
  });

  it("INV-DT-003: cese sets vigente_hasta + motivo_cese (allowed), but is final (cannot change again)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt003b");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt003b");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-J', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        const id = row.rows[0].id;

        // Cese: allowed.
        await tx.query(
          `UPDATE fsj.designacion_director_tecnico SET vigente_hasta = '2026-06-30', motivo_cese = 'renuncia' WHERE id = $1`,
          [id],
        );

        // Changing vigente_hasta again afterwards: rejected (cese is final).
        // Savepoint-wrapped (via expectInvariantViolation) so the second
        // assertion below still genuinely exercises the motivo_cese check.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET vigente_hasta = '2026-07-31' WHERE id = $1`, [id]),
          "INV-DT-003",
        );

        // Rewriting motivo_cese alone afterwards: also rejected.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET motivo_cese = 'otro motivo' WHERE id = $1`, [id]),
          "INV-DT-003",
        );
      }),
    );
  });

  it("INV-DT-003: motivo_cese without vigente_hasta is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt003c");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt003c");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-L', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`UPDATE fsj.designacion_director_tecnico SET motivo_cese = 'sin fecha' WHERE id = $1`, [
              row.rows[0].id,
            ]),
          "INV-DT-003",
        );
      }),
    );
  });

  it("designacion_director_tecnico rows are never deleted (generic forbid_delete)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dtdel");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dtdel");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-K', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.designacion_director_tecnico WHERE id = $1`, [row.rows[0].id]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("fsj.es_dt_vigente() is true within [vigente_desde, vigente_hasta] and false at the boundaries outside it", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "esdt");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "esdt");
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-L', '2026-03-01', '2026-03-31', $3)`,
          [tenantId, dt, sistema],
        );

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const before = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-02-28') AS v`, [dt]);
          expect(before.rows[0].v).toBe(false);

          const startBoundary = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-03-01') AS v`, [dt]);
          expect(startBoundary.rows[0].v).toBe(true);

          const endBoundary = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-03-31') AS v`, [dt]);
          expect(endBoundary.rows[0].v).toBe(true);

          const after = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-04-01') AS v`, [dt]);
          expect(after.rows[0].v).toBe(false);
        });
      }),
    );
  });

  it("fsj.es_dt_vigente() with no app.tenant_id set returns false regardless of data (RLS)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "esdtnotenant");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "esdtnotenant");
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-M', '2026-01-01', $3)`,
          [tenantId, dt, sistema],
        );

        await tx.query("SET LOCAL ROLE fsj_app");
        const result = await tx.query(`SELECT fsj.es_dt_vigente($1, '2026-06-01') AS v`, [dt]);
        expect(result.rows[0].v).toBe(false);
      }),
    );
  });
});
