/**
 * DB tests for prisma/migrations/*_0136_metodo_verificacion_habilitado (openspec/changes/metodos-verificacion-operador).
 *
 * `fsj.metodo_verificacion_habilitado (tenant_id, metodo)` is a presence set of the OPTIONAL verification methods a
 * farmacia has switched on: tenant-scoped (RLS ENABLE + FORCE), replaced by delete + insert (no UPDATE), and the PIN
 * can never be a row (it is always on, in code). See tests/db/helpers.ts for the rollback safety model.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectDbRejection } from "./helpers";
import { insertTenant } from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("0136_metodo_verificacion_habilitado (fsj schema)", () => {
  it("has RLS enabled AND forced", async () => {
    await asOwner(async (client) => {
      const { rows } = await client.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'fsj.metodo_verificacion_habilitado'::regclass`);
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });

  it("isolates rows by tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "mv-a");
        const tenantB = await insertTenant(tx, "mv-b");
        await tx.query(`INSERT INTO fsj.metodo_verificacion_habilitado (tenant_id, metodo) VALUES ($1, 'HUELLA'), ($2, 'HUELLA')`, [tenantA, tenantB]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantA, async (c) => {
          const { rows } = await c.query(`SELECT tenant_id FROM fsj.metodo_verificacion_habilitado`);
          expect(rows).toEqual([{ tenant_id: tenantA }]);
        });
      }),
    );
  });

  it("fsj_app cannot insert a row for another tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "mv-c");
        const tenantB = await insertTenant(tx, "mv-d");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantA, async (c) => {
          await expectDbRejection(c, () => c.query(`INSERT INTO fsj.metodo_verificacion_habilitado (tenant_id, metodo) VALUES ($1, 'HUELLA')`, [tenantB]), "42501");
        });
      }),
    );
  });

  it("fsj_app can insert and delete but not update (the set is replaced by delete + insert)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "mv-e");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          await c.query(`INSERT INTO fsj.metodo_verificacion_habilitado (tenant_id, metodo) VALUES ($1, 'HUELLA')`, [tenantId]);
          await expectDbRejection(c, () => c.query(`UPDATE fsj.metodo_verificacion_habilitado SET metodo = 'ROSTRO' WHERE tenant_id = $1`, [tenantId]), "42501");
          const borradas = await c.query(`DELETE FROM fsj.metodo_verificacion_habilitado WHERE tenant_id = $1`, [tenantId]);
          expect(borradas.rowCount).toBe(1);
        });
      }),
    );
  });

  it("the PIN can never be a row, and the method must look like a registry code", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "mv-f");
        for (const metodo of ["PIN", "huella", "H", "CON ESPACIO"]) {
          await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.metodo_verificacion_habilitado (tenant_id, metodo) VALUES ($1, $2)`, [tenantId, metodo]), "23514");
        }
      }),
    );
  });

  it("a method is stored once per tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "mv-g");
        await tx.query(`INSERT INTO fsj.metodo_verificacion_habilitado (tenant_id, metodo) VALUES ($1, 'HUELLA')`, [tenantId]);
        await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.metodo_verificacion_habilitado (tenant_id, metodo) VALUES ($1, 'HUELLA')`, [tenantId]), "23505");
      }),
    );
  });
});
