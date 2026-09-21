/**
 * DB tests for prisma/migrations/*_0002_usuarios_roles_permisos.
 *
 * See tests/db/helpers.ts for the rollback-transaction safety model.
 * INV-U02 tests use `SET CONSTRAINTS ALL IMMEDIATE` mid-transaction (not
 * via inRollbackTx's `setConstraintsImmediate` option, which would run it
 * BEFORE any inserts -- see helpers.ts) to force the deferred constraint
 * trigger to run at a chosen point instead of waiting for a COMMIT that
 * never happens in this suite.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asApp, asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection } from "./helpers";

async function insertTenant(tx: Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function rolId(tx: Client, codigo: string): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = $1`, [codigo]);
  return result.rows[0].id as string;
}

/** Self-created SISTEMA user (creado_por_id = its own id), with the internal SISTEMA role assigned -- mirrors scripts/create-tenant.ts. */
async function createSistemaUser(tx: Client, tenantId: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
     VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
    [id, tenantId, `sistema+${id}@internal.local`, `SISTEMA-${id}`],
  );
  const sistemaRolId = await rolId(tx, "SISTEMA");
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRolId,
  ]);
  return id;
}

describe.skipIf(dbTestSkipReason() !== null)("0002_usuarios_roles_permisos migration (fsj schema)", () => {
  it("seeds the 5 assignable roles plus the internal SISTEMA role", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT codigo FROM fsj.rol ORDER BY codigo`);
        const codes = result.rows.map((r) => r.codigo as string);
        for (const expected of [
          "ADMINISTRADOR",
          "ATENCION_PUBLICO",
          "DIRECTOR_TECNICO",
          "FARMACEUTICO",
          "SISTEMA",
          "SOLO_CONSULTA",
        ]) {
          expect(codes).toContain(expected);
        }
      }),
    );
  });

  it("seeds a non-empty rol_permiso matrix for ADMINISTRADOR", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(
          `SELECT count(*)::int AS n FROM fsj.rol_permiso rp JOIN fsj.rol r ON r.id = rp.rol_id WHERE r.codigo = 'ADMINISTRADOR'`,
        );
        expect(result.rows[0].n).toBeGreaterThan(0);
      }),
    );
  });

  it("fsj_app cannot INSERT into the global catalogs (rol/permiso/rol_permiso are read-only)", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        await expectDbRejection(tx, () => tx.query(`INSERT INTO fsj.rol (codigo, nombre) VALUES ('X_TEST', 'X')`), "42501");
      }),
    );
  });

  it("INV-U01: usuario.creado_por_id is NOT NULL", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "u01");
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1, $2, 'N', 'A', 'D1', NULL)`,
              [tenantId, `u01-${Date.now()}@example.com`],
            ),
          "23502",
        );
      }),
    );
  });

  it("INV-U02: a user with zero roles fails when constraints are checked", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "u02a");
        const sistema = await createSistemaUser(tx, tenantId);
        const userId = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A','D2',$4)`,
          [userId, tenantId, `u02a-${Date.now()}@example.com`, sistema],
        );
        // No usuario_rol row inserted for userId.
        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-U02");
      }),
    );
  });

  it("INV-U02: a user with >= 1 role passes when constraints are checked", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "u02b");
        const sistema = await createSistemaUser(tx, tenantId);
        const userId = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A','D3',$4)`,
          [userId, tenantId, `u02b-${Date.now()}@example.com`, sistema],
        );
        const farmaceuticoId = await rolId(tx, "FARMACEUTICO");
        await tx.query(
          `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`,
          [tenantId, userId, farmaceuticoId, sistema],
        );
        // Must NOT throw.
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
      }),
    );
  });

  it("INV-U02: removing a user's last role fails when constraints are checked", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "u02c");
        const sistema = await createSistemaUser(tx, tenantId);
        const userId = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A','D4',$4)`,
          [userId, tenantId, `u02c-${Date.now()}@example.com`, sistema],
        );
        const farmaceuticoId = await rolId(tx, "FARMACEUTICO");
        const assignment = await tx.query(
          `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4) RETURNING id`,
          [tenantId, userId, farmaceuticoId, sistema],
        );
        await tx.query(`DELETE FROM fsj.usuario_rol WHERE id = $1`, [assignment.rows[0].id]);
        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-U02");
      }),
    );
  });

  it("INV-U02: removing one of two roles still passes (one remains)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "u02d");
        const sistema = await createSistemaUser(tx, tenantId);
        const userId = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A','D4b',$4)`,
          [userId, tenantId, `u02d-${Date.now()}@example.com`, sistema],
        );
        const farmaceuticoId = await rolId(tx, "FARMACEUTICO");
        const atpId = await rolId(tx, "ATENCION_PUBLICO");
        await tx.query(
          `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`,
          [tenantId, userId, farmaceuticoId, sistema],
        );
        const second = await tx.query(
          `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4) RETURNING id`,
          [tenantId, userId, atpId, sistema],
        );
        await tx.query(`DELETE FROM fsj.usuario_rol WHERE id = $1`, [second.rows[0].id]);
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE"); // FARMACEUTICO remains -- must not throw.
      }),
    );
  });

  it("INV-U03 (via generic INV-IMMUTABLE trigger): DELETE on usuario is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "u03");
        const sistema = await createSistemaUser(tx, tenantId);
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.usuario WHERE id = $1`, [sistema]), "INV-IMMUTABLE");
      }),
    );
  });

  it("INV-USR-006: valid transitions succeed, invalid ones are rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "u006");
        const sistema = await createSistemaUser(tx, tenantId);
        const userId = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A','D5',$4)`,
          [userId, tenantId, `u006-${Date.now()}@example.com`, sistema],
        ); // starts PENDIENTE_ACTIVACION

        // PENDIENTE_ACTIVACION -> SUSPENDIDO is not a legal transition. This
        // is wrapped in a savepoint (via expectInvariantViolation) precisely
        // because the valid transitions below MUST still run afterwards --
        // without it, the aborted transaction would make every subsequent
        // query here fail regardless of whether the state machine is
        // correct (see tests/db/helpers.ts's aborted-transaction rule).
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [userId]),
          "INV-USR-006",
        );

        await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [userId]);
        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [userId]);
        await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [userId]);
        await tx.query(`UPDATE fsj.usuario SET estado = 'BAJA' WHERE id = $1`, [userId]);

        // BAJA is terminal for now (DP-02 pending).
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [userId]),
          "INV-USR-006",
        );
      }),
    );
  });

  it("DP-40: usuario.email is globally unique across tenants", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "emailA");
        const tenantB = await insertTenant(tx, "emailB");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const sistemaB = await createSistemaUser(tx, tenantB);
        const dupEmail = `dup-${Date.now()}@example.com`;

        await tx.query(
          `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,'N','A','D6',$3)`,
          [tenantA, dupEmail, sistemaA],
        );
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,'N','A','D7',$3)`,
              [tenantB, dupEmail, sistemaB],
            ),
          "23505",
        );
      }),
    );
  });

  it("usuario.dni is unique per tenant, but the same dni is allowed across different tenants", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "dniA");
        const tenantB = await insertTenant(tx, "dniB");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const sistemaB = await createSistemaUser(tx, tenantB);
        const sharedDni = `SAMEDNI${Date.now()}`;

        await tx.query(
          `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,'N','A',$3,$4)`,
          [tenantA, `dniA-${Date.now()}@example.com`, sharedDni, sistemaA],
        );
        // Same DNI, different tenant: allowed.
        await tx.query(
          `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,'N','A',$3,$4)`,
          [tenantB, `dniB-${Date.now()}@example.com`, sharedDni, sistemaB],
        );
        // Same DNI, same tenant: rejected.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,'N','A',$3,$4)`,
              [tenantA, `dniA2-${Date.now()}@example.com`, sharedDni, sistemaA],
            ),
          "23505",
        );
      }),
    );
  });
});
