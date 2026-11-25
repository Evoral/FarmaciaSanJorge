/**
 * DB tests for prisma/migrations/*_0137_credencial_operador (openspec/changes/metodos-verificacion-operador).
 *
 * `fsj.credencial_operador (tenant_id, usuario_id, metodo, hash, ...)` holds the argon2id hash of an empleado's secret
 * code for an OPTIONAL verification method (the huella): tenant-scoped (RLS ENABLE + FORCE), one row per
 * (usuario, method), a composite FK to the usuario of its own tenant, and fsj_app may only replace the hash (no other
 * column), insert and delete. See tests/db/helpers.ts for the rollback safety model.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectDbRejection } from "./helpers";
import { createSistemaUser, createUserWithRole, insertTenant } from "./fixtures";

async function tenantConUsuario(tx: Parameters<typeof insertTenant>[0], suffix: string): Promise<{ tenantId: string; usuarioId: string }> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const usuarioId = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, suffix);
  return { tenantId, usuarioId };
}

describe.skipIf(dbTestSkipReason() !== null)("0137_credencial_operador (fsj schema)", () => {
  it("has RLS enabled AND forced", async () => {
    await asOwner(async (client) => {
      const { rows } = await client.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'fsj.credencial_operador'::regclass`);
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });

  it("isolates rows by tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await tenantConUsuario(tx, "co-a");
        const b = await tenantConUsuario(tx, "co-b");
        await tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h1'), ($3, $4, 'HUELLA', 'h2')`, [a.tenantId, a.usuarioId, b.tenantId, b.usuarioId]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, a.tenantId, async (c) => {
          const { rows } = await c.query(`SELECT tenant_id, usuario_id FROM fsj.credencial_operador`);
          expect(rows).toEqual([{ tenant_id: a.tenantId, usuario_id: a.usuarioId }]);
        });
      }),
    );
  });

  it("fsj_app cannot insert a row for another tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await tenantConUsuario(tx, "co-c");
        const b = await tenantConUsuario(tx, "co-d");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, a.tenantId, async (c) => {
          await expectDbRejection(c, () => c.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h')`, [b.tenantId, b.usuarioId]), "42501");
        });
      }),
    );
  });

  it("only a usuario of the same tenant can own a credential (composite FK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await tenantConUsuario(tx, "co-e");
        const b = await tenantConUsuario(tx, "co-f");
        await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h')`, [a.tenantId, b.usuarioId]), "23503");
      }),
    );
  });

  it("fsj_app can insert, replace the hash and delete, but not touch any other column", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, usuarioId } = await tenantConUsuario(tx, "co-g");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          await c.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h1')`, [tenantId, usuarioId]);
          const reemplazo = await c.query(`UPDATE fsj.credencial_operador SET hash = 'h2', actualizado_en = now() WHERE tenant_id = $1 AND usuario_id = $2`, [tenantId, usuarioId]);
          expect(reemplazo.rowCount).toBe(1);
          await expectDbRejection(c, () => c.query(`UPDATE fsj.credencial_operador SET metodo = 'ROSTRO' WHERE tenant_id = $1`, [tenantId]), "42501");
          await expectDbRejection(c, () => c.query(`UPDATE fsj.credencial_operador SET usuario_id = usuario_id WHERE tenant_id = $1`, [tenantId]), "42501");
          await expectDbRejection(c, () => c.query(`UPDATE fsj.credencial_operador SET creado_en = now() WHERE tenant_id = $1`, [tenantId]), "42501");
          const borradas = await c.query(`DELETE FROM fsj.credencial_operador WHERE tenant_id = $1`, [tenantId]);
          expect(borradas.rowCount).toBe(1);
        });
      }),
    );
  });

  it("the PIN can never be a row, and the method must look like a registry code", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, usuarioId } = await tenantConUsuario(tx, "co-h");
        for (const metodo of ["PIN", "huella", "H", "CON ESPACIO"]) {
          await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, $3, 'h')`, [tenantId, usuarioId, metodo]), "23514");
        }
      }),
    );
  });

  it("a usuario has at most one credential per method", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, usuarioId } = await tenantConUsuario(tx, "co-i");
        await tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h1')`, [tenantId, usuarioId]);
        await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'HUELLA', 'h2')`, [tenantId, usuarioId]), "23505");
        // Another method is another row.
        await tx.query(`INSERT INTO fsj.credencial_operador (tenant_id, usuario_id, metodo, hash) VALUES ($1, $2, 'ROSTRO', 'h3')`, [tenantId, usuarioId]);
      }),
    );
  });

  it("indexes the composite FK to usuario (the PK leads with tenant_id, usuario_id)", async () => {
    await asOwner(async (client) => {
      const { rows } = await client.query(
        `SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i WHERE i.indrelid = 'fsj.credencial_operador'::regclass AND i.indisprimary`,
      );
      expect(rows[0]!.def).toContain("(tenant_id, usuario_id, metodo)");
    });
  });
});
