/**
 * DB tests for prisma/migrations/*_0000_platform_roles/migration.sql.
 *
 * Runs against the REAL database (DATABASE_URL/DIRECT_URL) -- there is no
 * separate test project. Every test wraps its work in `inRollbackTx()` so
 * nothing it does (including `CREATE TABLE`/`CREATE TRIGGER`/`GRANT`, all
 * transactional DDL in Postgres) survives past the test. See the warning
 * in tests/db/global-setup.ts and tests/db/helpers.ts.
 *
 * Self-skips (not fails) when the DB test env isn't configured
 * (`FSJ_DB_TESTS=yes` + DATABASE_URL/DIRECT_URL), so this file is safe to
 * run standalone as well as via `npm run test:db`.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asApp, asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";

describe.skipIf(dbTestSkipReason() !== null)("platform roles migration (fsj schema)", () => {
  it("fsj_app cannot CREATE TABLE in fsj", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        await expectDbRejection(tx, () => tx.query("CREATE TABLE fsj.should_not_exist (id uuid PRIMARY KEY)"), "42501");
      }),
    );
  });

  it("fsj_app has no BYPASSRLS", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query<{ rolbypassrls: boolean }>(
          "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'fsj_app'",
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].rolbypassrls).toBe(false);
      }),
    );
  });

  it("fsj.current_tenant_id() returns null without a setting", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query("SELECT fsj.current_tenant_id() AS tenant_id");
        expect(result.rows[0].tenant_id).toBeNull();
      }),
    );
  });

  it("fsj.current_tenant_id() returns the configured uuid inside a transaction", async () => {
    const tenantId = randomUUID();
    await asApp((client) =>
      inRollbackTx(client, (tx) =>
        withTenant(tx, tenantId, async (c) => {
          const result = await c.query("SELECT fsj.current_tenant_id() AS tenant_id");
          expect(result.rows[0].tenant_id).toBe(tenantId);
        }),
      ),
    );
  });

  it("forbid_tenant_id_change trigger rejects UPDATE of tenant_id (INV-T03)", async () => {
    const tableName = `scratch_inv_t03_${Date.now()}`;

    // Everything -- CREATE TABLE, CREATE TRIGGER, GRANT, INSERT, and the
    // UPDATE we expect to fail -- happens on ONE connection inside ONE
    // transaction that inRollbackTx always rolls back. DDL is
    // transactional in Postgres, so the scratch table never actually
    // exists outside this test, and there is no DROP TABLE to remember.
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await tx.query(`
          CREATE TABLE fsj.${tableName} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL
          )
        `);
        await tx.query(`
          CREATE TRIGGER trg_${tableName}_forbid_tenant_id_change
            BEFORE UPDATE ON fsj.${tableName}
            FOR EACH ROW EXECUTE FUNCTION fsj.forbid_tenant_id_change()
        `);
        await tx.query(`GRANT SELECT, INSERT, UPDATE ON fsj.${tableName} TO fsj_app`);

        const originalTenant = randomUUID();
        const otherTenant = randomUUID();
        const rowId = randomUUID();

        await tx.query(`INSERT INTO fsj.${tableName} (id, tenant_id) VALUES ($1, $2)`, [rowId, originalTenant]);

        // A failed statement aborts the transaction (Postgres only accepts
        // ROLLBACK afterwards) -- fine here, inRollbackTx rolls back next anyway.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.${tableName} SET tenant_id = $1 WHERE id = $2`, [otherTenant, rowId]),
          "INV-T03",
        );
      }),
    );
  });
});
