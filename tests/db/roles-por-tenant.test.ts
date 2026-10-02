/**
 * DB tests for migration 0054 (DP-03 RESUELTA: per-tenant, editable,
 * audited roles -- docs/specs/roles-personalizables.md):
 *   - RLS isolation of fsj.rol / fsj.rol_permiso across tenants (fsj_app);
 *   - composite FK usuario_rol (tenant_id, rol_id): no cross-tenant role;
 *   - FK to the global permiso catalog: an unknown permiso is impossible;
 *   - protection triggers INV-ROL-001..005 (ADMINISTRADOR / SISTEMA /
 *     DIRECTOR_TECNICO / assigned roles / SISTEMA assignment);
 *   - post-migration shape of the EXISTING data (the migration itself
 *     aborts if any non-admin usuario's effective permisos changed -- see
 *     its step 7 -- so here we assert what must hold afterwards).
 * Every test runs inside inRollbackTx (tests/db/helpers.ts) -- nothing persists.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import { insertTenant, createSistemaUser, createUserWithRole } from "./fixtures";

async function rol(tx: Client, tenantId: string, codigo: string): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.rol WHERE tenant_id = $1 AND codigo = $2`, [tenantId, codigo]);
  return result.rows[0].id as string;
}

async function permisoId(tx: Client, codigo: string): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.permiso WHERE codigo = $1`, [codigo]);
  return result.rows[0].id as string;
}

async function insertCustomRol(tx: Client, tenantId: string, codigo: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.rol (tenant_id, codigo, nombre) VALUES ($1, $2, $3) RETURNING id`, [tenantId, codigo, `Rol ${codigo}`]);
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("migration 0054: per-tenant roles", () => {
  it("RLS: fsj_app only sees its own tenant's roles and rol_permiso rows", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "rolA");
        const tenantB = await insertTenant(tx, "rolB");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantA, async (c) => {
          const roles = await c.query(`SELECT DISTINCT tenant_id FROM fsj.rol`);
          expect(roles.rows.map((r) => r.tenant_id)).toEqual([tenantA]);
          const pares = await c.query(`SELECT DISTINCT tenant_id FROM fsj.rol_permiso`);
          expect(pares.rows.map((r) => r.tenant_id)).toEqual([tenantA]);
          // ...and cannot create a role in another tenant (WITH CHECK).
          await expectDbRejection(c, () => c.query(`INSERT INTO fsj.rol (tenant_id, codigo, nombre) VALUES ($1, 'X', 'X')`, [tenantB]), "42501");
        });
      }),
    );
  });

  it("fsj_app can create a custom role, edit its nombre/descripcion, set its permisos and delete it (cascade)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "rol-crud");
        const stockVer = await permisoId(tx, "stock.ver");
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const id = await insertCustomRol(c, tenantId, "CADETE");
          await c.query(`INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id) VALUES ($1, $2, $3)`, [tenantId, id, stockVer]);
          await c.query(`UPDATE fsj.rol SET nombre = 'Cadete', descripcion = 'Mostrador' WHERE id = $1`, [id]);
          await c.query(`DELETE FROM fsj.rol WHERE id = $1`, [id]);
          const quedan = await c.query(`SELECT count(*)::int AS n FROM fsj.rol_permiso WHERE rol_id = $1`, [id]);
          expect(quedan.rows[0].n).toBe(0);
          // permiso stays read-only for fsj_app.
          await expectDbRejection(c, () => c.query(`UPDATE fsj.permiso SET descripcion = 'x' WHERE id = $1`, [stockVer]), "42501");
        });
      }),
    );
  });

  it("an unknown permiso can never be stored (FK to the global catalog)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "rol-fk");
        const id = await insertCustomRol(tx, tenantId, "CADETE");
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id) VALUES ($1, $2, $3)`, [tenantId, id, randomUUID()]),
          "23503",
        );
      }),
    );
  });

  it("usuario_rol cannot point at another tenant's role (composite FK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "xA");
        const tenantB = await insertTenant(tx, "xB");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const rolDeB = await rol(tx, tenantB, "FARMACEUTICO");
        const userId = await createUserWithRole(tx, tenantA, "FARMACEUTICO", sistemaA, "xa");
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $4)`, [tenantA, userId, rolDeB, sistemaA]),
          "23503",
        );
      }),
    );
  });

  it("INV-ROL-002: ADMINISTRADOR cannot be modified, deleted, or get rol_permiso rows", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "adm");
        const admin = await rol(tx, tenantId, "ADMINISTRADOR");
        const stockVer = await permisoId(tx, "stock.ver");
        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.rol SET nombre = 'Jefe' WHERE id = $1`, [admin]), "INV-ROL-002");
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.rol WHERE id = $1`, [admin]), "INV-ROL-002");
        await expectInvariantViolation(
          tx,
          () => tx.query(`INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id) VALUES ($1, $2, $3)`, [tenantId, admin, stockVer]),
          "INV-ROL-002",
        );
      }),
    );
  });

  it("INV-ROL-002: SISTEMA cannot be modified, deleted, or get permisos", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sis");
        const sistema = await rol(tx, tenantId, "SISTEMA");
        const stockVer = await permisoId(tx, "stock.ver");
        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.rol SET descripcion = 'x' WHERE id = $1`, [sistema]), "INV-ROL-002");
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.rol WHERE id = $1`, [sistema]), "INV-ROL-002");
        await expectInvariantViolation(
          tx,
          () => tx.query(`INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id) VALUES ($1, $2, $3)`, [tenantId, sistema, stockVer]),
          "INV-ROL-002",
        );
      }),
    );
  });

  it("INV-ROL-001: codigo and es_administrador are immutable; the flag is tied to ADMINISTRADOR (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "cod");
        const far = await rol(tx, tenantId, "FARMACEUTICO");
        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.rol SET codigo = 'FARMA' WHERE id = $1`, [far]), "INV-ROL-001");
        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.rol SET es_administrador = true WHERE id = $1`, [far]), "INV-ROL-001");
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.rol (tenant_id, codigo, nombre, es_administrador) VALUES ($1, 'SUPER', 'Super', true)`, [tenantId]),
          "23514",
        );
      }),
    );
  });

  it("INV-ROL-003: DIRECTOR_TECNICO cannot be deleted, but its permisos/nombre can change", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt");
        const dt = await rol(tx, tenantId, "DIRECTOR_TECNICO");
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.rol WHERE id = $1`, [dt]), "INV-ROL-003");
        await tx.query(`UPDATE fsj.rol SET nombre = 'DT' WHERE id = $1`, [dt]);
        await tx.query(`DELETE FROM fsj.rol_permiso WHERE rol_id = $1 AND permiso_id = $2`, [dt, await permisoId(tx, "stock.ver")]);
      }),
    );
  });

  it("INV-ROL-004: a role assigned to a usuario cannot be deleted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "asig");
        const sistema = await createSistemaUser(tx, tenantId);
        await createUserWithRole(tx, tenantId, "SOLO_CONSULTA", sistema, "asig");
        const soloConsulta = await rol(tx, tenantId, "SOLO_CONSULTA");
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.rol WHERE id = $1`, [soloConsulta]), "INV-ROL-004");
        // ...while an unassigned default role can be deleted.
        await tx.query(`DELETE FROM fsj.rol WHERE id = $1`, [await rol(tx, tenantId, "ATENCION_PUBLICO")]);
      }),
    );
  });

  it("INV-ROL-005: SISTEMA cannot be assigned to a human usuario", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sis-asig");
        const sistema = await createSistemaUser(tx, tenantId);
        const userId = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "hum");
        const rolSistema = await rol(tx, tenantId, "SISTEMA");
        await expectInvariantViolation(
          tx,
          () => tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $4)`, [tenantId, userId, rolSistema, sistema]),
          "INV-ROL-005",
        );
      }),
    );
  });

  it("after the migration: no tenant-less role remains, every tenant has exactly one locked ADMINISTRADOR, every assignment stays in its tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const sinTenant = await tx.query(`SELECT count(*)::int AS n FROM fsj.rol WHERE tenant_id IS NULL`);
        expect(sinTenant.rows[0].n).toBe(0);
        const admins = await tx.query(
          `SELECT t.id, count(r.id) FILTER (WHERE r.codigo = 'ADMINISTRADOR' AND r.es_administrador)::int AS n
           FROM fsj.tenant t LEFT JOIN fsj.rol r ON r.tenant_id = t.id GROUP BY t.id`,
        );
        expect(admins.rows.filter((row) => row.n !== 1)).toEqual([]);
        const cruzadas = await tx.query(
          `SELECT count(*)::int AS n FROM fsj.usuario_rol ur JOIN fsj.rol r ON r.id = ur.rol_id WHERE r.tenant_id <> ur.tenant_id`,
        );
        expect(cruzadas.rows[0].n).toBe(0);
      }),
    );
  });
});
