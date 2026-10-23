/**
 * DB tests for FASE 2 points 2.2 (login) and 2.4 (change-password) -- the
 * `fsj.usuario_resolve_login` bootstrap function (migration
 * 0010_usuario_login_resolver), the raw column shapes `login()`'s decision
 * table depends on, and the "revoke other sessions" / audit-row shapes
 * `cambiarPassword()` relies on.
 *
 * Same raw-`pg` + `asOwner`/`asApp` + `inRollbackTx` harness as every
 * other tests/db/*.test.ts (see tests/db/auth-sessions.test.ts's module
 * doc comment for why the actual TypeScript application functions are
 * NOT called here -- Prisma opens its own connection, so nesting it
 * inside this harness's BEGIN...ROLLBACK would not actually nest).
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, asApp, inRollbackTx } from "./helpers";

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
  const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE tenant_id = $1 AND codigo = 'SISTEMA'`, [tenantId]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRol.rows[0].id,
  ]);
  return id;
}

interface NewUsuarioOptions {
  estado?: "PENDIENTE_ACTIVACION" | "ACTIVO" | "SUSPENDIDO" | "BAJA";
  passwordHash?: string | null;
  intentosFallidos?: number;
  bloqueadoHasta?: Date | null;
}

/** A regular (non-SISTEMA) usuario, walked through legal state transitions, with a real role. */
async function createUsuario(
  tx: Client,
  tenantId: string,
  sistemaId: string,
  suffix: string,
  opts: NewUsuarioOptions = {},
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, email, `D-${suffix}-${Math.random().toString(36).slice(2, 6)}`, sistemaId],
  );
  const rolId = await tx.query(`SELECT id FROM fsj.rol WHERE tenant_id = $1 AND codigo = 'FARMACEUTICO'`, [tenantId]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rolId.rows[0].id,
    sistemaId,
  ]);

  const estado = opts.estado ?? "ACTIVO";
  // Walk PENDIENTE_ACTIVACION -> ACTIVO -> (target) so every transition stays legal
  // (INV-USR-006: trg_usuario_validar_transicion_estado).
  if (estado !== "PENDIENTE_ACTIVACION") {
    await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [id]);
    if (estado !== "ACTIVO") {
      await tx.query(`UPDATE fsj.usuario SET estado = $2 WHERE id = $1`, [id, estado]);
    }
  }
  if (opts.passwordHash !== undefined) {
    await tx.query(`UPDATE fsj.usuario SET password_hash = $2 WHERE id = $1`, [id, opts.passwordHash]);
  }
  if (opts.intentosFallidos !== undefined) {
    await tx.query(`UPDATE fsj.usuario SET intentos_fallidos = $2 WHERE id = $1`, [id, opts.intentosFallidos]);
  }
  if (opts.bloqueadoHasta !== undefined) {
    await tx.query(`UPDATE fsj.usuario SET bloqueado_hasta = $2 WHERE id = $1`, [id, opts.bloqueadoHasta]);
  }

  return { id, email };
}

function rawTokenHash(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  return { rawToken, tokenHash };
}

describe.skipIf(dbTestSkipReason() !== null)("fsj.usuario_resolve_login (migration 0010)", () => {
  it("resolves tenant_id/usuario_id/password_hash/estado/lockout fields for a known email", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "resolve-ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "login", {
          estado: "ACTIVO",
          passwordHash: "argon2-hash-placeholder",
          intentosFallidos: 2,
        });

        const result = await tx.query(`SELECT * FROM fsj.usuario_resolve_login($1)`, [usuario.email]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
          tenant_id: tenantId,
          usuario_id: usuario.id,
          password_hash: "argon2-hash-placeholder",
          estado: "ACTIVO",
          intentos_fallidos: 2,
        });
      }),
    );
  });

  it("returns ZERO ROWS (not a row of nulls) for an unknown email", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT * FROM fsj.usuario_resolve_login($1)`, [`nobody-${randomUUID()}@example.com`]);
        expect(result.rows).toHaveLength(0);
      }),
    );
  });

  it("resolves a PENDIENTE_ACTIVACION usuario too (the resolver does not filter by estado; login decides)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "resolve-pendiente");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "pend", { estado: "PENDIENTE_ACTIVACION" });

        const result = await tx.query(`SELECT * FROM fsj.usuario_resolve_login($1)`, [usuario.email]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({ tenant_id: tenantId, usuario_id: usuario.id, estado: "PENDIENTE_ACTIVACION", password_hash: null });
      }),
    );
  });

  it("login rejects a SUSPENDIDO usuario: the resolved row round-trips estado = 'SUSPENDIDO', exactly what decideLogin's INACTIVE branch needs", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "resolve-susp");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "susp", { estado: "SUSPENDIDO", passwordHash: "hash" });

        const result = await tx.query(`SELECT * FROM fsj.usuario_resolve_login($1)`, [usuario.email]);
        expect(result.rows[0].estado).toBe("SUSPENDIDO");
      }),
    );
  });

  it("fsj_app has EXECUTE on the function", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT * FROM fsj.usuario_resolve_login($1)`, [`no-such-${randomUUID()}@example.com`]);
        expect(result.rows).toHaveLength(0);
      }),
    );
  });

  it("fsj_app still cannot SELECT fsj.usuario directly without app.tenant_id set -- the function is the ONE bootstrap exception, not a general RLS bypass", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT count(*)::int AS n FROM fsj.usuario`);
        expect(result.rows[0].n).toBe(0);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("login lockout bookkeeping and its audit row (FASE 2 point 2.2)", () => {
  it("LOGIN_FALLIDO_BLOQUEO audit row lands with the affected usuario as its own author, alongside the lockout write, in one transaction", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "lockout-audit");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "lock", { estado: "ACTIVO", passwordHash: "hash", intentosFallidos: 4 });

        await tx.query(`UPDATE fsj.usuario SET intentos_fallidos = 5, bloqueado_hasta = now() + interval '15 minutes' WHERE id = $1`, [
          usuario.id,
        ]);
        const audit = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, motivo)
           VALUES ($1, $2, 'usuario', $2, 'LOGIN_FALLIDO_BLOQUEO', 'Bloqueo tras 5 intentos fallidos consecutivos.') RETURNING accion, motivo`,
          [tenantId, usuario.id],
        );

        expect(audit.rows[0].accion).toBe("LOGIN_FALLIDO_BLOQUEO");

        const row = await tx.query(`SELECT intentos_fallidos, bloqueado_hasta FROM fsj.usuario WHERE id = $1`, [usuario.id]);
        expect(row.rows[0].intentos_fallidos).toBe(5);
        expect(row.rows[0].bloqueado_hasta).not.toBeNull();
      }),
    );
  });

  it("a successful login resets intentos_fallidos and bloqueado_hasta, and stamps ultimo_acceso", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "reset-ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "reset", {
          estado: "ACTIVO",
          passwordHash: "hash",
          intentosFallidos: 3,
        });

        await tx.query(`UPDATE fsj.usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id = $1`, [usuario.id]);

        const row = await tx.query(`SELECT intentos_fallidos, bloqueado_hasta, ultimo_acceso FROM fsj.usuario WHERE id = $1`, [usuario.id]);
        expect(row.rows[0].intentos_fallidos).toBe(0);
        expect(row.rows[0].bloqueado_hasta).toBeNull();
        expect(row.rows[0].ultimo_acceso).not.toBeNull();
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("cambiarPassword revokes other sessions (FASE 2 point 2.4)", () => {
  it("revokes every OTHER active session for the usuario, but keeps the one that made the change alive", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "revoke-others");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "multi", { estado: "ACTIVO", passwordHash: "old-hash" });

        const { tokenHash: hashKeep } = rawTokenHash();
        const { tokenHash: hashOther1 } = rawTokenHash();
        const { tokenHash: hashOther2 } = rawTokenHash();

        const keep = await tx.query(
          `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en) VALUES ($1,$2,$3, now() + interval '12 hours') RETURNING id`,
          [tenantId, usuario.id, hashKeep],
        );
        const other1 = await tx.query(
          `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en) VALUES ($1,$2,$3, now() + interval '12 hours') RETURNING id`,
          [tenantId, usuario.id, hashOther1],
        );
        const other2 = await tx.query(
          `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en) VALUES ($1,$2,$3, now() + interval '12 hours') RETURNING id`,
          [tenantId, usuario.id, hashOther2],
        );
        const keepId = keep.rows[0].id as string;

        // Mirrors revokeOtherSesionesForUsuario exactly.
        const result = await tx.query(
          `UPDATE fsj.sesion SET revocada_en = now() WHERE tenant_id = $1 AND usuario_id = $2 AND revocada_en IS NULL AND id <> $3`,
          [tenantId, usuario.id, keepId],
        );
        expect(result.rowCount).toBe(2);

        const rows = await tx.query(`SELECT id, revocada_en FROM fsj.sesion WHERE id = ANY($1::uuid[])`, [
          [keepId, other1.rows[0].id, other2.rows[0].id],
        ]);
        const byId = new Map(rows.rows.map((r) => [r.id as string, r.revocada_en]));
        expect(byId.get(keepId)).toBeNull();
        expect(byId.get(other1.rows[0].id)).not.toBeNull();
        expect(byId.get(other2.rows[0].id)).not.toBeNull();
      }),
    );
  });

  it("MODIFICAR audit row for a password change lands with the usuario as author, no password/hash value stored", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "pw-audit");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "pwaudit", { estado: "ACTIVO", passwordHash: "old-hash" });

        await tx.query(`UPDATE fsj.usuario SET password_hash = $2 WHERE id = $1`, [usuario.id, "new-hash"]);
        const audit = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, motivo)
           VALUES ($1, $2, 'usuario', $2, 'MODIFICAR', 'Cambio de contraseña por el propio usuario.') RETURNING accion, motivo, valor_anterior, valor_nuevo`,
          [tenantId, usuario.id],
        );

        expect(audit.rows[0].accion).toBe("MODIFICAR");
        expect(audit.rows[0].valor_anterior).toBeNull();
        expect(audit.rows[0].valor_nuevo).toBeNull();
      }),
    );
  });
});
