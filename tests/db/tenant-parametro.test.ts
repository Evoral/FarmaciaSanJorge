/**
 * DB tests for prisma/migrations/*_0001_tenant_parametro_multi_tenant_infra.
 *
 * See tests/db/platform-roles.test.ts and tests/db/helpers.ts for the
 * "single real database, everything rolls back" safety model this suite
 * relies on.
 *
 * A note on technique: several tests below need to assert what `fsj_app`
 * (no BYPASSRLS) sees under RLS, but also need to seed rows first as the
 * migration owner (`postgres`, which DOES bypass RLS -- confirmed by
 * platform-roles.test.ts's "fsj_app has no BYPASSRLS" test, and relied on
 * by scripts/db-bootstrap.ts and scripts/create-tenant.ts). Since there is
 * only one database and no second `fsj_app` connection could see
 * still-uncommitted owner-inserted rows anyway (different session, no
 * dirty reads), these tests use `SET LOCAL ROLE fsj_app` to switch the
 * SAME connection's effective role for the remainder of the transaction
 * instead of opening a second connection. `SET LOCAL` is transaction-scoped
 * and reverts automatically at ROLLBACK regardless.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asApp, asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import { insertTenant } from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("0001_tenant_parametro_multi_tenant_infra migration (fsj schema)", () => {
  it("fsj.tenant: cuit is unique", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const cuit = `20-${Date.now()}-1`;
        await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ($1, $2)`, ["Farmacia Test", cuit]);
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ($1, $2)`, ["Otra Farmacia", cuit]),
          "23505",
        );
      }),
    );
  });

  it("fsj_app cannot INSERT into fsj.tenant (creation is a platform-operator operation, not runtime)", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('x', $1)`, [`20-${Date.now()}-2`]),
          "42501",
        );
      }),
    );
  });

  it("fsj_app can UPDATE the editable tenant columns but not cuit", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenant = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('A', $1) RETURNING id`, [
          `20-${Date.now()}-3`,
        ]);
        const tenantId = tenant.rows[0].id as string;
        await tx.query(`GRANT SELECT ON fsj.tenant TO fsj_app`); // already granted by migration; explicit for clarity

        await tx.query("SET LOCAL ROLE fsj_app");
        // FIX (migration 0020, FASE 3 point 3.10): 0020 added a BEFORE
        // UPDATE trigger (trg_tenant_forbid_cross_tenant_update) that
        // rejects ANY fsj_app UPDATE of fsj.tenant -- regardless of which
        // columns change -- unless app.tenant_id matches the row being
        // updated (INV-PL-004). This test previously ran the UPDATE below
        // with NO app.tenant_id set at all, which passed only because 0020
        // did not exist yet; post-0020 that same UPDATE now fails with
        // INV-PL-004 instead of exercising what this test is actually
        // about (the column-level GRANT). `withTenant` sets app.tenant_id
        // the same way shared/db/transaction.ts#withTenantTransaction does
        // in production, which is what makes the razon_social UPDATE below
        // succeed again. See the new "0020_tenant_datos_editables" describe
        // block below for the narrowed-grant/cross-tenant-trigger tests
        // themselves.
        await withTenant(tx, tenantId, async (c) => {
          await c.query(`UPDATE fsj.tenant SET razon_social = 'B' WHERE id = $1`, [tenantId]);
          await expectDbRejection(
            c,
            () => c.query(`UPDATE fsj.tenant SET cuit = '99-99999999-9' WHERE id = $1`, [tenantId]),
            "42501",
          );
        });
      }),
    );
  });

  it("fsj.setup_tenant_table: RLS isolates rows by tenant_id, two tenants (INV-T01)", async () => {
    const tableName = `scratch_inv_t01_${Date.now()}`;
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await tx.query(`
          CREATE TABLE fsj.${tableName} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            UNIQUE (tenant_id, id)
          )
        `);
        await tx.query(`SELECT fsj.setup_tenant_table('fsj.${tableName}')`);
        await tx.query(`GRANT SELECT, INSERT ON fsj.${tableName} TO fsj_app`);

        const tenantA = randomUUID();
        const tenantB = randomUUID();
        await tx.query(`INSERT INTO fsj.${tableName} (tenant_id) VALUES ($1), ($2)`, [tenantA, tenantB]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantA, async (c) => {
          const result = await c.query(`SELECT tenant_id FROM fsj.${tableName}`);
          expect(result.rows).toHaveLength(1);
          expect(result.rows[0].tenant_id).toBe(tenantA);
        });
      }),
    );
  });

  it("fsj.setup_tenant_table: no app.tenant_id set => zero rows visible under RLS (INV-T01)", async () => {
    const tableName = `scratch_inv_t01b_${Date.now()}`;
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await tx.query(`
          CREATE TABLE fsj.${tableName} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            UNIQUE (tenant_id, id)
          )
        `);
        await tx.query(`SELECT fsj.setup_tenant_table('fsj.${tableName}')`);
        await tx.query(`GRANT SELECT, INSERT ON fsj.${tableName} TO fsj_app`);
        await tx.query(`INSERT INTO fsj.${tableName} (tenant_id) VALUES ($1)`, [randomUUID()]);

        await tx.query("SET LOCAL ROLE fsj_app");
        const result = await tx.query(`SELECT * FROM fsj.${tableName}`);
        expect(result.rows).toHaveLength(0);
      }),
    );
  });

  it("fsj.setup_tenant_table: an INSERT for another tenant than app.tenant_id is rejected (RLS WITH CHECK, INV-T01)", async () => {
    const tableName = `scratch_inv_t01c_${Date.now()}`;
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await tx.query(`
          CREATE TABLE fsj.${tableName} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            UNIQUE (tenant_id, id)
          )
        `);
        await tx.query(`SELECT fsj.setup_tenant_table('fsj.${tableName}')`);
        await tx.query(`GRANT SELECT, INSERT ON fsj.${tableName} TO fsj_app`);

        const tenantA = randomUUID();
        const tenantB = randomUUID();

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantA, async (c) => {
          await expectDbRejection(c, () => c.query(`INSERT INTO fsj.${tableName} (tenant_id) VALUES ($1)`, [tenantB]), "42501");
        });
      }),
    );
  });

  it("composite FK across tenants is rejected (INV-T02)", async () => {
    const parent = `scratch_parent_${Date.now()}`;
    const child = `scratch_child_${Date.now()}`;
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await tx.query(`
          CREATE TABLE fsj.${parent} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            UNIQUE (tenant_id, id)
          )
        `);
        await tx.query(`
          CREATE TABLE fsj.${child} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            parent_id uuid NOT NULL,
            FOREIGN KEY (tenant_id, parent_id) REFERENCES fsj.${parent} (tenant_id, id)
          )
        `);

        const tenantA = randomUUID();
        const tenantB = randomUUID();
        const parentRow = await tx.query(`INSERT INTO fsj.${parent} (tenant_id) VALUES ($1) RETURNING id`, [tenantA]);
        const parentId = parentRow.rows[0].id as string;

        // Child row claims tenant B but points at a tenant-A parent id --
        // no row in parent has (tenant_id, id) = (tenantB, parentId), so
        // the composite FK rejects it. This is how INV-T02 ("no relation
        // crosses tenants") is guaranteed in the DB, not just in app code.
        // Wrapped in a savepoint (via expectDbRejection) because the
        // sanity-check insert below MUST still run afterwards -- see
        // tests/db/helpers.ts's aborted-transaction rule.
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.${child} (tenant_id, parent_id) VALUES ($1, $2)`, [tenantB, parentId]),
          "23503",
        );

        // Sanity check: the same-tenant insert succeeds.
        await tx.query(`INSERT INTO fsj.${child} (tenant_id, parent_id) VALUES ($1, $2)`, [tenantA, parentId]);
      }),
    );
  });

  it("fsj.setup_tenant_table: UPDATE of tenant_id is rejected (INV-T03)", async () => {
    const tableName = `scratch_inv_t03_${Date.now()}`;
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await tx.query(`
          CREATE TABLE fsj.${tableName} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            UNIQUE (tenant_id, id)
          )
        `);
        await tx.query(`SELECT fsj.setup_tenant_table('fsj.${tableName}')`);
        await tx.query(`GRANT SELECT, INSERT, UPDATE ON fsj.${tableName} TO fsj_app`);

        const tenantA = randomUUID();
        const tenantB = randomUUID();
        const row = await tx.query(`INSERT INTO fsj.${tableName} (tenant_id) VALUES ($1) RETURNING id`, [tenantA]);
        const rowId = row.rows[0].id as string;

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.${tableName} SET tenant_id = $1 WHERE id = $2`, [tenantB, rowId]),
          "INV-T03",
        );
      }),
    );
  });

  it("fsj.parametro: PK (tenant_id, clave) rejects duplicates within a tenant, allows the same clave across tenants", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('A', $1) RETURNING id`, [
          `20-${Date.now()}-5`,
        ]);
        const tenantB = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('B', $1) RETURNING id`, [
          `20-${Date.now()}-6`,
        ]);
        const tenantAId = tenantA.rows[0].id as string;
        const tenantBId = tenantB.rows[0].id as string;

        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'vencimiento_credencial_horas', 'NUMERO', '72')`,
          [tenantAId],
        );
        // Same clave, different tenant: must succeed.
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'vencimiento_credencial_horas', 'NUMERO', '72')`,
          [tenantBId],
        );
        // Same clave, same tenant: must fail (PK violation).
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'vencimiento_credencial_horas', 'NUMERO', '48')`,
              [tenantAId],
            ),
          "23505",
        );
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("0020_tenant_datos_editables migration (fsj schema, FASE 3 point 3.10)", () => {
  it("fsj_app can UPDATE all 4 editable columns on its OWN tenant row", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0020a");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          await c.query(
            `UPDATE fsj.tenant SET razon_social = 'B', nombre_fantasia = 'Fantasia', domicilio = 'Calle 1', matricula_farmacia = 'MAT-1' WHERE id = $1`,
            [tenantId],
          );
          const result = await c.query(`SELECT razon_social, nombre_fantasia, domicilio, matricula_farmacia FROM fsj.tenant WHERE id = $1`, [
            tenantId,
          ]);
          expect(result.rows[0]).toMatchObject({
            razon_social: "B",
            nombre_fantasia: "Fantasia",
            domicilio: "Calle 1",
            matricula_farmacia: "MAT-1",
          });
        });
      }),
    );
  });

  // cuit was NEVER granted to fsj_app (not even by migration 0001) -- this
  // is not a NEW restriction from 0020, but it is part of the task's
  // required (b) coverage: fsj_app UPDATE of cuit fails with 42501. If the
  // GRANT statement in migration 0001/0020 were changed to include cuit,
  // this test would start failing (the UPDATE would unexpectedly succeed),
  // which is exactly how it proves the grant is what's enforcing this.
  it("fsj_app UPDATE of cuit fails with SQLSTATE 42501 (never granted)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0020b1");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          await expectDbRejection(c, () => c.query(`UPDATE fsj.tenant SET cuit = '99-99999999-9' WHERE id = $1`, [tenantId]), "42501");
        });
      }),
    );
  });

  // zona_horaria IS the narrowed-grant case migration 0020 introduces:
  // migration 0001 originally granted UPDATE on zona_horaria too: this test
  // would fail (the UPDATE would unexpectedly succeed) if 0020's
  // `REVOKE UPDATE ON fsj.tenant FROM fsj_app; GRANT UPDATE (razon_social,
  // nombre_fantasia, domicilio, matricula_farmacia) ...` were reverted to
  // 0001's original (wider) grant -- proving this test actually exercises
  // 0020's narrowing, not just a grant that always excluded it.
  it("fsj_app UPDATE of zona_horaria fails with SQLSTATE 42501 (excluded by migration 0020's narrowed grant)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0020b2");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          await expectDbRejection(
            c,
            () => c.query(`UPDATE fsj.tenant SET zona_horaria = 'Etc/GMT+12' WHERE id = $1`, [tenantId]),
            "42501",
          );
        });
      }),
    );
  });

  // If trg_tenant_forbid_cross_tenant_update (migration 0020) were dropped,
  // this UPDATE would succeed: razon_social IS a granted column, fsj.tenant
  // has no tenant_id column and no RLS (it IS the tenant boundary), so
  // nothing else in the schema would stop fsj_app from editing a tenant
  // other than the one set on the current session. This is exactly the
  // hole INV-PL-004 closes.
  it("fsj_app UPDATE targeting a DIFFERENT tenant's row fails with INV-PL-004, even for an allowed column", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantAId = await insertTenant(tx, "0020c-a");
        const tenantBId = await insertTenant(tx, "0020c-b");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantAId, async (c) => {
          await expectInvariantViolation(
            c,
            () => c.query(`UPDATE fsj.tenant SET razon_social = 'Hijacked' WHERE id = $1`, [tenantBId]),
            "INV-PL-004",
          );
        });
      }),
    );
  });

  // Sanity-checks the trigger's `current_user = 'fsj_app'` scoping
  // (migration 0020's own doc comment: "fsj_owner is intentionally NOT
  // restricted by this trigger"). No SET LOCAL ROLE fsj_app here at all --
  // still connected as the migration owner, with no app.tenant_id set
  // either, which is exactly the scenario migrations/seed scripts/
  // scripts/create-tenant.ts run in. If the trigger's `current_user`
  // check were removed (checking fsj.current_tenant_id() unconditionally),
  // this owner UPDATE would start failing with INV-PL-004 too.
  it("fsj_owner is NOT blocked by the INV-PL-004 trigger", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0020d");
        await tx.query(`UPDATE fsj.tenant SET razon_social = 'Owner edit' WHERE id = $1`, [tenantId]);
        const result = await tx.query(`SELECT razon_social FROM fsj.tenant WHERE id = $1`, [tenantId]);
        expect(result.rows[0].razon_social).toBe("Owner edit");
      }),
    );
  });
});
