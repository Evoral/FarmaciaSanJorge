/**
 * DB tests for prisma/migrations/*_0003_registro_auditoria.
 * See tests/db/helpers.ts for the rollback-transaction safety model.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection } from "./helpers";

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

describe.skipIf(dbTestSkipReason() !== null)("0003_registro_auditoria migration (fsj schema)", () => {
  it("a well-formed audit row can be inserted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const result = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
           VALUES ($1, $2, 'usuario', $3, 'CREAR') RETURNING id`,
          [tenantId, sistema, sistema],
        );
        expect(result.rows).toHaveLength(1);
      }),
    );
  });

  it("INV-A03: usuario_id NULL is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "a03");
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
               VALUES ($1, NULL, 'usuario', $2, 'CREAR')`,
              [tenantId, randomUUID()],
            ),
          "23502",
        );
      }),
    );
  });

  it("INV-A02: UPDATE on registro_auditoria is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "a02u");
        const sistema = await createSistemaUser(tx, tenantId);
        const row = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
           VALUES ($1, $2, 'usuario', $2, 'CREAR') RETURNING id`,
          [tenantId, sistema],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.registro_auditoria SET motivo = 'edited' WHERE id = $1`, [row.rows[0].id]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("INV-A02: DELETE on registro_auditoria is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "a02d");
        const sistema = await createSistemaUser(tx, tenantId);
        const row = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
           VALUES ($1, $2, 'usuario', $2, 'CREAR') RETURNING id`,
          [tenantId, sistema],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.registro_auditoria WHERE id = $1`, [row.rows[0].id]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("a rolled-back operation leaves no audit row behind", async () => {
    // Demonstrates the suite's own safety net (tests/db/helpers.ts#inRollbackTx):
    // insert inside a transaction, then roll back via a SAVEPOINT to check
    // the row is gone, all still inside the outer rollback-only transaction.
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "rb");
        const sistema = await createSistemaUser(tx, tenantId);

        await tx.query("SAVEPOINT sp_audit");
        const row = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
           VALUES ($1, $2, 'usuario', $2, 'CREAR') RETURNING id`,
          [tenantId, sistema],
        );
        await tx.query("ROLLBACK TO SAVEPOINT sp_audit");

        const result = await tx.query(`SELECT 1 FROM fsj.registro_auditoria WHERE id = $1`, [row.rows[0].id]);
        expect(result.rows).toHaveLength(0);
      }),
    );
  });

  it("registro_auditoria FK rejects a usuario_id from a different tenant (INV-T02)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "fkA");
        const tenantB = await insertTenant(tx, "fkB");
        const sistemaB = await createSistemaUser(tx, tenantB);

        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
               VALUES ($1, $2, 'usuario', $2, 'CREAR')`,
              [tenantA, sistemaB],
            ),
          "23503",
        );
      }),
    );
  });
});
