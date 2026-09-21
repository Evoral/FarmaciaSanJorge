/**
 * DB tests for FASE 2 points 2.2 (login) and 2.3 (activation) -- the new
 * `fsj.usuario_resolve_login` bootstrap function (migration
 * 0010_usuario_login_resolver), the atomic activation-credential
 * consumption `login.ts`/`activar-cuenta.ts` rely on, the raw column
 * shapes `login()`'s decision table depends on, and the "revoke other
 * sessions" / audit-row shapes `cambiarPassword()`/`activarCuenta()` rely
 * on.
 *
 * Same raw-`pg` + `asOwner`/`asApp` + `inRollbackTx` harness as every
 * other tests/db/*.test.ts (see tests/db/auth-sessions.test.ts's module
 * doc comment for why the actual TypeScript application functions are
 * NOT called here -- Prisma opens its own connection, so nesting it
 * inside this harness's BEGIN...ROLLBACK would not actually nest).
 *
 * CONCURRENCY NOTE: this suite shares ONE real Supabase database with no
 * dedicated test project yet (tests/db/helpers.ts's own module doc
 * comment flags this as a known gap, "revisit before production
 * go-live"). A literal two-CONNECTION race would require committing
 * fixture rows for a second `pg.Client` to see them, which this suite's
 * safety model (nothing survives past `ROLLBACK`) forbids. The
 * "concurrent attempts" test below instead fires both UPDATE attempts via
 * `Promise.all` against the SAME already-open transaction -- which does
 * not exercise genuine multi-connection scheduling, but DOES prove the
 * property that actually guarantees "exactly one winner" under real
 * concurrency: the UPDATE's WHERE clause (`usada_en IS NULL AND
 * revocada_en IS NULL AND vence_en > now()`) is what makes a second
 * attempt match zero rows once the first has applied, not any incidental
 * timing.
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
  const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'SISTEMA'`);
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
  const rolId = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'FARMACEUTICO'`);
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

async function insertCredencial(tx: Client, tenantId: string, usuarioId: string, emitidaPorId: string, tokenHash: string): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, vence_en, motivo_emision)
     VALUES ($1, $2, $3, $4, now() + interval '72 hours', 'ALTA') RETURNING id`,
    [tenantId, usuarioId, tokenHash, emitidaPorId],
  );
  return result.rows[0].id as string;
}

/** Mirrors `consumeCredencialActivacion` (modules/auth/infrastructure/usuario-repository.ts) exactly. */
async function consumeCredencial(tx: Client, usuarioId: string, tokenHash: string): Promise<number> {
  const result = await tx.query(
    `UPDATE fsj.credencial_activacion
     SET usada_en = now()
     WHERE usuario_id = $1 AND token_hash = $2 AND usada_en IS NULL AND revocada_en IS NULL AND vence_en > now()`,
    [usuarioId, tokenHash],
  );
  return result.rowCount ?? 0;
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

  it("resolves a PENDIENTE_ACTIVACION usuario too (activarCuenta reuses this same function)", async () => {
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

describe.skipIf(dbTestSkipReason() !== null)("activation credential atomic consumption (FASE 2 point 2.3, INV-AU-002)", () => {
  it("a valid credential is consumed exactly once: count 1 on first attempt", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "consume-ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "act", { estado: "PENDIENTE_ACTIVACION" });
        const { tokenHash } = rawTokenHash();
        await insertCredencial(tx, tenantId, usuario.id, sistema, tokenHash);

        const consumed = await consumeCredencial(tx, usuario.id, tokenHash);
        expect(consumed).toBe(1);
      }),
    );
  });

  it("a second attempt on the SAME credential (already consumed) matches zero rows", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "consume-twice");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "act2", { estado: "PENDIENTE_ACTIVACION" });
        const { tokenHash } = rawTokenHash();
        await insertCredencial(tx, tenantId, usuario.id, sistema, tokenHash);

        const first = await consumeCredencial(tx, usuario.id, tokenHash);
        const second = await consumeCredencial(tx, usuario.id, tokenHash);
        expect(first).toBe(1);
        expect(second).toBe(0);
      }),
    );
  });

  it("two CONCURRENT consumption attempts on the same credential produce exactly one winner (see module doc comment for the single-connection caveat)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "consume-race");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "act3", { estado: "PENDIENTE_ACTIVACION" });
        const { tokenHash } = rawTokenHash();
        await insertCredencial(tx, tenantId, usuario.id, sistema, tokenHash);

        const [a, b] = await Promise.all([consumeCredencial(tx, usuario.id, tokenHash), consumeCredencial(tx, usuario.id, tokenHash)]);
        const winners = [a, b].filter((n) => n === 1).length;
        const losers = [a, b].filter((n) => n === 0).length;
        expect(winners).toBe(1);
        expect(losers).toBe(1);
      }),
    );
  });

  it("a wrong email (resolves a DIFFERENT usuario_id) never consumes someone else's credential -- zero rows, no separate check needed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "consume-wrong-user");
        const sistema = await createSistemaUser(tx, tenantId);
        const owner = await createUsuario(tx, tenantId, sistema, "owner", { estado: "PENDIENTE_ACTIVACION" });
        const other = await createUsuario(tx, tenantId, sistema, "other", { estado: "PENDIENTE_ACTIVACION" });
        const { tokenHash } = rawTokenHash();
        await insertCredencial(tx, tenantId, owner.id, sistema, tokenHash);

        // Simulates activarCuenta(email = other's email, codigo = owner's raw code).
        const consumed = await consumeCredencial(tx, other.id, tokenHash);
        expect(consumed).toBe(0);

        // The real owner's attempt still succeeds afterwards.
        const consumedByOwner = await consumeCredencial(tx, owner.id, tokenHash);
        expect(consumedByOwner).toBe(1);
      }),
    );
  });

  it("an expired credential is never consumed, even addressed by the right usuario/token", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "consume-expired");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "exp", { estado: "PENDIENTE_ACTIVACION" });
        const { tokenHash } = rawTokenHash();
        await tx.query(
          `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, emitida_en, vence_en, motivo_emision)
           VALUES ($1, $2, $3, $2, now() - interval '96 hours', now() - interval '24 hours', 'ALTA')`,
          [tenantId, usuario.id, tokenHash],
        );

        const consumed = await consumeCredencial(tx, usuario.id, tokenHash);
        expect(consumed).toBe(0);
      }),
    );
  });

  it("activation completes: usuario flips PENDIENTE_ACTIVACION -> ACTIVO and gets a password_hash, in the same transaction as the consumption", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "activate-full");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "full", { estado: "PENDIENTE_ACTIVACION" });
        const { tokenHash } = rawTokenHash();
        await insertCredencial(tx, tenantId, usuario.id, sistema, tokenHash);

        const consumed = await consumeCredencial(tx, usuario.id, tokenHash);
        expect(consumed).toBe(1);

        await tx.query(`UPDATE fsj.usuario SET password_hash = $2, estado = 'ACTIVO' WHERE id = $1`, [usuario.id, "new-hash"]);

        const row = await tx.query(`SELECT estado, password_hash FROM fsj.usuario WHERE id = $1`, [usuario.id]);
        expect(row.rows[0]).toMatchObject({ estado: "ACTIVO", password_hash: "new-hash" });
      }),
    );
  });

  it("ACTIVAR_CUENTA audit row lands with the activating usuario as its own author (usuario_id), inside the same transaction", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "activate-audit");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuario = await createUsuario(tx, tenantId, sistema, "audit", { estado: "PENDIENTE_ACTIVACION" });
        const { tokenHash } = rawTokenHash();
        await insertCredencial(tx, tenantId, usuario.id, sistema, tokenHash);

        await consumeCredencial(tx, usuario.id, tokenHash);
        await tx.query(`UPDATE fsj.usuario SET password_hash = 'h', estado = 'ACTIVO' WHERE id = $1`, [usuario.id]);

        const audit = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
           VALUES ($1, $2, 'usuario', $2, 'ACTIVAR_CUENTA') RETURNING id, usuario_id, accion`,
          [tenantId, usuario.id],
        );
        expect(audit.rows[0]).toMatchObject({ usuario_id: usuario.id, accion: "ACTIVAR_CUENTA" });
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
