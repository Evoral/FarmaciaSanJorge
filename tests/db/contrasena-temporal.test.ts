/**
 * DB tests for migration 0097_contrasena_temporal (docs/specs/contrasena-temporal.md): the new
 * `fsj.usuario.debe_cambiar_password` flag, its column-level UPDATE grant to `fsj_app`, and the one-off revocation of
 * every live `credencial_activacion`. Same raw-`pg` + `asOwner` + `inRollbackTx` harness as tests/db/auth-pin.test.ts.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant } from "./helpers";

type Tx = import("pg").Client;

const MIGRATION_SQL = join(process.cwd(), "prisma/migrations/20261022100000_0097_contrasena_temporal/migration.sql");

async function insertTenant(tx: Tx, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function createSistemaUser(tx: Tx, tenantId: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
     VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
    [id, tenantId, `sistema+${id}@internal.local`, `SISTEMA-${id}`],
  );
  const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE tenant_id = $1 AND codigo = 'SISTEMA'`, [tenantId]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRol.rows[0].id,
  ]);
  return id;
}

async function createUsuarioPendiente(tx: Tx, tenantId: string, sistemaId: string, suffix: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, `${suffix}-${id}@example.com`, `D-${suffix}-${Math.random().toString(36).slice(2, 6)}`, sistemaId],
  );
  return id;
}

async function createUsuarioActivo(tx: Tx, tenantId: string, sistemaId: string, suffix: string): Promise<string> {
  const id = await createUsuarioPendiente(tx, tenantId, sistemaId, suffix);
  const rolId = await tx.query(`SELECT id FROM fsj.rol WHERE tenant_id = $1 AND codigo = 'FARMACEUTICO'`, [tenantId]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rolId.rows[0].id,
    sistemaId,
  ]);
  await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [id]);
  return id;
}

interface CredencialSeed {
  usuarioId: string;
  emitidaEn: string;
  venceEn: string;
  usadaEn: string | null;
  revocadaEn: string | null;
}

async function insertCredencial(tx: Tx, tenantId: string, emitidaPorId: string, seed: CredencialSeed): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.credencial_activacion
       (id, tenant_id, usuario_id, token_hash, emitida_por_id, emitida_en, vence_en, usada_en, revocada_en, motivo_emision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ALTA')`,
    [id, tenantId, seed.usuarioId, `hash-${id}`, emitidaPorId, seed.emitidaEn, seed.venceEn, seed.usadaEn, seed.revocadaEn],
  );
  return id;
}

/** ISO instant `dias` days from now (negative = past). */
function enDias(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString();
}

describe.skipIf(dbTestSkipReason() !== null)("migration 0097_contrasena_temporal", () => {
  it("defaults debe_cambiar_password to false for a new usuario", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ct-default");
        const sistemaId = await createSistemaUser(tx, tenantId);
        const usuarioId = await createUsuarioPendiente(tx, tenantId, sistemaId, "default");

        const row = await tx.query(`SELECT debe_cambiar_password FROM fsj.usuario WHERE id = $1`, [usuarioId]);
        expect(row.rows[0].debe_cambiar_password).toBe(false);
      }),
    );
  });

  it("accepts an ACTIVO insert with password_hash and debe_cambiar_password = true", async () => {
    // The state trigger only watches UPDATE OF estado, so an alta can insert straight into ACTIVO.
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ct-activo");
        const sistemaId = await createSistemaUser(tx, tenantId);
        const id = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, password_hash, debe_cambiar_password, creado_por_id)
           VALUES ($1, $2, $3, 'N', 'A', $4, 'ACTIVO', 'argon2-placeholder', true, $5)`,
          [id, tenantId, `activo-${id}@example.com`, `D-activo-${Math.random().toString(36).slice(2, 6)}`, sistemaId],
        );

        const row = await tx.query(`SELECT estado, password_hash, debe_cambiar_password FROM fsj.usuario WHERE id = $1`, [id]);
        expect(row.rows[0]).toMatchObject({ estado: "ACTIVO", password_hash: "argon2-placeholder", debe_cambiar_password: true });
      }),
    );
  });

  it("fsj_app can UPDATE debe_cambiar_password via its column-level GRANT", async () => {
    // The fixture runs as the owner (fsj_app cannot INSERT into fsj.tenant); the grant under test runs as fsj_app.
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ct-grant");
        const sistemaId = await createSistemaUser(tx, tenantId);
        const usuarioId = await createUsuarioActivo(tx, tenantId, sistemaId, "grant");

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (scoped) => {
          await scoped.query(`UPDATE fsj.usuario SET debe_cambiar_password = true WHERE id = $1`, [usuarioId]);
          const row = await scoped.query(`SELECT debe_cambiar_password FROM fsj.usuario WHERE id = $1`, [usuarioId]);
          expect(row.rows[0].debe_cambiar_password).toBe(true);
        });
      }),
    );
  });

  it("0097 revokes only live credencial_activacion rows", async () => {
    // Extract the data statement from the migration file itself, so the test breaks if it is edited.
    const sinComentarios = readFileSync(MIGRATION_SQL, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const match = /UPDATE fsj\.credencial_activacion[^;]*;/.exec(sinComentarios);
    expect(match).not.toBeNull();
    const revokeSql = match![0];

    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ct-revoke");
        const sistemaId = await createSistemaUser(tx, tenantId);
        // The one-active partial unique index allows a single live credencial per usuario: one usuario per row.
        const uVigente = await createUsuarioPendiente(tx, tenantId, sistemaId, "cred-vigente");
        const uVencida = await createUsuarioPendiente(tx, tenantId, sistemaId, "cred-vencida");
        const uUsada = await createUsuarioPendiente(tx, tenantId, sistemaId, "cred-usada");
        const uRevocada = await createUsuarioPendiente(tx, tenantId, sistemaId, "cred-revocada");

        const vigente = await insertCredencial(tx, tenantId, sistemaId, {
          usuarioId: uVigente,
          emitidaEn: enDias(-1),
          venceEn: enDias(2),
          usadaEn: null,
          revocadaEn: null,
        });
        const vencida = await insertCredencial(tx, tenantId, sistemaId, {
          usuarioId: uVencida,
          emitidaEn: enDias(-10),
          venceEn: enDias(-5),
          usadaEn: null,
          revocadaEn: null,
        });
        const usada = await insertCredencial(tx, tenantId, sistemaId, {
          usuarioId: uUsada,
          emitidaEn: enDias(-4),
          venceEn: enDias(1),
          usadaEn: enDias(-3),
          revocadaEn: null,
        });
        const revocadaEn = enDias(-2);
        const revocada = await insertCredencial(tx, tenantId, sistemaId, {
          usuarioId: uRevocada,
          emitidaEn: enDias(-4),
          venceEn: enDias(1),
          usadaEn: null,
          revocadaEn,
        });

        await tx.query(revokeSql);

        const rows = await tx.query(`SELECT id, usada_en, revocada_en FROM fsj.credencial_activacion WHERE id = ANY($1::uuid[])`, [
          [vigente, vencida, usada, revocada],
        ]);
        const byId = new Map(rows.rows.map((r) => [r.id as string, r]));
        expect(byId.get(vigente)!.revocada_en).not.toBeNull();
        expect(byId.get(vencida)!.revocada_en).not.toBeNull();
        expect(byId.get(usada)!.usada_en).not.toBeNull();
        expect(byId.get(usada)!.revocada_en).toBeNull();
        expect(byId.get(revocada)!.revocada_en.getTime()).toBe(new Date(revocadaEn).getTime());
        expect(byId.get(revocada)!.usada_en).toBeNull();
      }),
    );
  });
});
