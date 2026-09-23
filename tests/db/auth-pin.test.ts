/**
 * DB tests for migration 0037_pin_reautenticacion (PIN re-auth feature,
 * user decision 2026-09-23): the new `fsj.usuario` columns
 * (pin_hash/pin_intentos_fallidos/pin_bloqueado/pin_actualizado_en), the
 * `usuario_pin_bloqueado_requiere_pin` CHECK constraint, and the
 * column-level UPDATE grant to `fsj_app`. Same raw-`pg` +
 * `asOwner`/`asApp` + `inRollbackTx` harness as every other
 * tests/db/*.test.ts -- see tests/db/auth-sessions.test.ts's module doc
 * comment for why the TypeScript application functions are NOT called
 * here.
 *
 * NOT RUN as part of this change (task instruction: no DB tests are
 * executed here) -- written so the orchestrator's later `npm run test:db`
 * pass exercises it against a real database.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, asApp, inRollbackTx, withTenant, expectDbRejection } from "./helpers";

async function insertTenant(tx: import("pg").Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function createSistemaUser(tx: import("pg").Client, tenantId: string): Promise<string> {
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

async function createUsuarioActivo(tx: import("pg").Client, tenantId: string, sistemaId: string, suffix: string): Promise<string> {
  const id = randomUUID();
  const email = `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, email, `D-${suffix}-${Math.random().toString(36).slice(2, 6)}`, sistemaId],
  );
  const rolId = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'FARMACEUTICO'`);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rolId.rows[0].id,
    sistemaId,
  ]);
  await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [id]);
  return id;
}

describe.skipIf(dbTestSkipReason() !== null)("migration 0037_pin_reautenticacion", () => {
  it("pin_* columns default to NULL/0/false and accept an ordinary update", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pin-defaults");
        const sistemaId = await createSistemaUser(tx, tenantId);
        const usuarioId = await createUsuarioActivo(tx, tenantId, sistemaId, "defaults");

        const before = await tx.query(
          `SELECT pin_hash, pin_intentos_fallidos, pin_bloqueado, pin_actualizado_en FROM fsj.usuario WHERE id = $1`,
          [usuarioId],
        );
        expect(before.rows[0]).toMatchObject({ pin_hash: null, pin_intentos_fallidos: 0, pin_bloqueado: false, pin_actualizado_en: null });

        await tx.query(`UPDATE fsj.usuario SET pin_hash = 'argon2-pin-hash-placeholder', pin_actualizado_en = now() WHERE id = $1`, [
          usuarioId,
        ]);
        const after = await tx.query(`SELECT pin_hash FROM fsj.usuario WHERE id = $1`, [usuarioId]);
        expect(after.rows[0].pin_hash).toBe("argon2-pin-hash-placeholder");
      }),
    );
  });

  it("usuario_pin_bloqueado_requiere_pin: pin_bloqueado = true with pin_hash NULL is rejected (23514)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pin-check-violation");
        const sistemaId = await createSistemaUser(tx, tenantId);
        const usuarioId = await createUsuarioActivo(tx, tenantId, sistemaId, "checkviol");

        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.usuario SET pin_bloqueado = true WHERE id = $1`, [usuarioId]),
          "23514",
        );
      }),
    );
  });

  it("usuario_pin_bloqueado_requiere_pin: pin_bloqueado = true WITH a pin_hash set is allowed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pin-check-ok");
        const sistemaId = await createSistemaUser(tx, tenantId);
        const usuarioId = await createUsuarioActivo(tx, tenantId, sistemaId, "checkok");

        await tx.query(`UPDATE fsj.usuario SET pin_hash = 'hash', pin_bloqueado = true WHERE id = $1`, [usuarioId]);
        const row = await tx.query(`SELECT pin_bloqueado FROM fsj.usuario WHERE id = $1`, [usuarioId]);
        expect(row.rows[0].pin_bloqueado).toBe(true);
      }),
    );
  });

  it("fsj_app (the app role) can UPDATE all four pin_* columns via its column-level GRANT", async () => {
    // Fixture AND the grant-under-test both run as fsj_app, on the SAME
    // rolled-back transaction/connection -- asOwner (table owner) would
    // bypass the grant entirely, so it cannot be used to check it (same
    // discipline as tests/db/auth-sessions.test.ts's asApp usages).
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pin-grant");
        await withTenant(tx, tenantId, async (scoped) => {
          const sistemaId = await createSistemaUser(scoped, tenantId);
          const usuarioId = await createUsuarioActivo(scoped, tenantId, sistemaId, "grant");

          await scoped.query(
            `UPDATE fsj.usuario SET pin_hash = 'hash', pin_intentos_fallidos = 1, pin_bloqueado = false, pin_actualizado_en = now() WHERE id = $1`,
            [usuarioId],
          );
          const row = await scoped.query(`SELECT pin_hash, pin_intentos_fallidos FROM fsj.usuario WHERE id = $1`, [usuarioId]);
          expect(row.rows[0]).toMatchObject({ pin_hash: "hash", pin_intentos_fallidos: 1 });
        });
      }),
    );
  });
});
