/**
 * DB tests for prisma/migrations/*_0004_credenciales_sesiones.
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

async function insertCredencial(
  tx: Client,
  tenantId: string,
  usuarioId: string,
  emitidaPorId: string,
  tokenHash: string,
): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, vence_en, motivo_emision)
     VALUES ($1, $2, $3, $4, now() + interval '72 hours', 'ALTA') RETURNING id`,
    [tenantId, usuarioId, tokenHash, emitidaPorId],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0004_credenciales_sesiones migration (fsj schema)", () => {
  it("a well-formed activation credential can be inserted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const id = await insertCredencial(tx, tenantId, sistema, sistema, `hash-${randomUUID()}`);
        expect(id).toBeTruthy();
      }),
    );
  });

  it("at most one ACTIVE credential per user: a second one is rejected (partial unique index)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dup");
        const sistema = await createSistemaUser(tx, tenantId);
        await insertCredencial(tx, tenantId, sistema, sistema, `hash-a-${randomUUID()}`);
        await expectDbRejection(
          tx,
          () => insertCredencial(tx, tenantId, sistema, sistema, `hash-b-${randomUUID()}`),
          "23505",
        );
      }),
    );
  });

  it("a second credential IS allowed once the first is used or revoked", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "reissue");
        const sistema = await createSistemaUser(tx, tenantId);
        const firstId = await insertCredencial(tx, tenantId, sistema, sistema, `hash-c-${randomUUID()}`);
        await tx.query(`UPDATE fsj.credencial_activacion SET usada_en = now() WHERE id = $1`, [firstId]);
        // Must NOT throw -- the partial index only counts non-used, non-revoked rows.
        await insertCredencial(tx, tenantId, sistema, sistema, `hash-d-${randomUUID()}`);
      }),
    );
  });

  it("INV-AU-002: usada_en cannot change once set", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "reuse");
        const sistema = await createSistemaUser(tx, tenantId);
        const id = await insertCredencial(tx, tenantId, sistema, sistema, `hash-e-${randomUUID()}`);
        await tx.query(`UPDATE fsj.credencial_activacion SET usada_en = now() WHERE id = $1`, [id]);
        // NOTE: now() is the TRANSACTION timestamp, so re-writing `now()`
        // here would store the identical value and the trigger's
        // IS DISTINCT FROM check would (correctly) see no change. Use an
        // explicitly different timestamp to assert the real rule.
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`UPDATE fsj.credencial_activacion SET usada_en = now() + interval '1 second' WHERE id = $1`, [id]),
          "INV-AU-002",
        );
      }),
    );
  });

  it("INV-AU-002: an expired credential cannot be consumed, even with a blind UPDATE", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "expired");
        const sistema = await createSistemaUser(tx, tenantId);
        // vence_en in the past: emitida_en is backdated so the CHECK still holds.
        const row = await tx.query(
          `INSERT INTO fsj.credencial_activacion
             (tenant_id, usuario_id, token_hash, emitida_por_id, emitida_en, vence_en, motivo_emision)
           VALUES ($1, $2, $3, $2, now() - interval '96 hours', now() - interval '24 hours', 'ALTA')
           RETURNING id`,
          [tenantId, sistema, `hash-exp-${randomUUID()}`],
        );
        const id = row.rows[0].id;

        // The application's WHERE clause is bypassed on purpose: the DB must still refuse.
        // Wrapped in a savepoint (via expectInvariantViolation) because the
        // revoke below MUST still succeed afterwards -- see the
        // aborted-transaction rule in tests/db/helpers.ts.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.credencial_activacion SET usada_en = now() WHERE id = $1`, [id]),
          "INV-AU-002",
        );

        // Revoking an expired credential stays legal.
        await tx.query(`UPDATE fsj.credencial_activacion SET revocada_en = now() WHERE id = $1`, [id]);
      }),
    );
  });

  it("a credential cannot be both usada_en and revocada_en (CHECK constraint)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "xor");
        const sistema = await createSistemaUser(tx, tenantId);
        const id = await insertCredencial(tx, tenantId, sistema, sistema, `hash-f-${randomUUID()}`);
        await tx.query(`UPDATE fsj.credencial_activacion SET usada_en = now() WHERE id = $1`, [id]);
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.credencial_activacion SET revocada_en = now() WHERE id = $1`, [id]),
          "23514",
        );
      }),
    );
  });

  it("vence_en must be after emitida_en (CHECK constraint)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "vence");
        const sistema = await createSistemaUser(tx, tenantId);
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, vence_en, motivo_emision)
               VALUES ($1, $2, $3, $2, now() - interval '1 hour', 'ALTA')`,
              [tenantId, sistema, `hash-g-${randomUUID()}`],
            ),
          "23514",
        );
      }),
    );
  });

  it("a well-formed sesion can be inserted, and expira_en must be after creada_en", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sesok");
        const sistema = await createSistemaUser(tx, tenantId);
        await tx.query(
          `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en) VALUES ($1, $2, $3, now() + interval '30 minutes')`,
          [tenantId, sistema, `sess-${randomUUID()}`],
        );
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en) VALUES ($1, $2, $3, now() - interval '1 minute')`,
              [tenantId, sistema, `sess-bad-${randomUUID()}`],
            ),
          "23514",
        );
      }),
    );
  });
});
