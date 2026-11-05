/**
 * DB tests for migration 0122_tenant_obligatorio (security audit P1-09).
 *
 * Migration 0122 makes `fsj.current_tenant_id()` raise SQLSTATE TN001
 * ('fsj: app.tenant_id is not set (query outside withTenantTransaction)')
 * when app.tenant_id is not set. Before this migration, RLS hid every row
 * silently (evaluating tenant_id = NULL), causing queries run outside
 * withTenantTransaction to return empty lists and UPDATE/DELETE to silently
 * change nothing.
 *
 * It also adds `fsj.tenant_id_o_null()`, which preserves the old behavior
 * (returning the id or NULL, never raising) for callers that need to detect
 * the absence of a tenant without throwing.
 *
 * Limitation / caveat:
 * TN001 only fires when a policy is evaluated on a candidate row; an empty table
 * (or a query matching zero candidate rows) still returns empty because the policy
 * expression is never evaluated. This is why every test below seeds a row first.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectDbRejection } from "./helpers";
import { insertTenant } from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("0122_tenant_obligatorio migration (fsj schema)", () => {
  it("fsj_app with no tenant: SELECT * FROM fsj.parametro WHERE tenant_id = $1 -> TN001", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0122_1");
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'test_0122', 'TEXTO', 'x')`,
          [tenantId],
        );
        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(
          tx,
          () => tx.query(`SELECT * FROM fsj.parametro WHERE tenant_id = $1`, [tenantId]),
          "TN001",
        );
      }),
    );
  });

  it("fsj_app with no tenant: UPDATE fsj.parametro SET valor = 'y' WHERE tenant_id = $1 AND clave = 'test_0122' -> TN001", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0122_2");
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'test_0122', 'TEXTO', 'x')`,
          [tenantId],
        );
        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `UPDATE fsj.parametro SET valor = 'y' WHERE tenant_id = $1 AND clave = 'test_0122'`,
              [tenantId],
            ),
          "TN001",
        );
      }),
    );
  });

  it("fsj_app with the tenant set (withTenant): the SELECT returns the row and the UPDATE reports rowCount 1", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0122_3");
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'test_0122', 'TEXTO', 'x')`,
          [tenantId],
        );
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const selectResult = await c.query(`SELECT * FROM fsj.parametro WHERE tenant_id = $1`, [tenantId]);
          expect(selectResult.rows).toHaveLength(1);
          expect(selectResult.rows[0].valor).toBe("x");

          const updateResult = await c.query(
            `UPDATE fsj.parametro SET valor = 'y' WHERE tenant_id = $1 AND clave = 'test_0122'`,
            [tenantId],
          );
          expect(updateResult.rowCount).toBe(1);
        });
      }),
    );
  });

  it("fsj.tenant_id_o_null(): NULL with no tenant (no error); the tenant id inside withTenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0122_4");
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'test_0122', 'TEXTO', 'x')`,
          [tenantId],
        );
        await tx.query("SET LOCAL ROLE fsj_app");
        const noTenantResult = await tx.query(`SELECT fsj.tenant_id_o_null() AS tid`);
        expect(noTenantResult.rows[0].tid).toBeNull();

        await withTenant(tx, tenantId, async (c) => {
          const withTenantResult = await c.query(`SELECT fsj.tenant_id_o_null() AS tid`);
          expect(withTenantResult.rows[0].tid).toBe(tenantId);
        });
      }),
    );
  });

  it("fsj.current_tenant_id() inside withTenant returns the tenant id", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "0122_5");
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'test_0122', 'TEXTO', 'x')`,
          [tenantId],
        );
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const result = await c.query(`SELECT fsj.current_tenant_id() AS tid`);
          expect(result.rows[0].tid).toBe(tenantId);
        });
      }),
    );
  });
});
