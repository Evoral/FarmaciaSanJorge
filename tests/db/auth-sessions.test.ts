/**
 * DB tests for FASE 2 point 2.1 (sessions) -- the new
 * `fsj.sesion_resolve_tenant` bootstrap function (migration
 * 0009_sesion_tenant_resolver) plus the raw data shapes `validateSession`
 * depends on for an expired / revoked / suspended-user session.
 *
 * SCOPE NOTE (read before extending this file): everything here uses the
 * raw-`pg` + `asOwner`/`asApp` + `inRollbackTx` harness from
 * tests/db/helpers.ts, exactly like every other tests/db/*.test.ts --
 * NOT the actual TypeScript session-service functions
 * (modules/auth/application/*). That is deliberate, not an oversight:
 * those functions go through Prisma, which opens its OWN connection (via
 * `@prisma/adapter-pg`) separate from the raw `pg.Client` this harness
 * uses. Nesting a Prisma-managed transaction inside this harness's
 * `BEGIN ... ROLLBACK` would not actually nest (Prisma would open a
 * second, independent transaction on a different connection) -- so a
 * Prisma call in here could COMMIT for real against the one shared
 * Supabase database this suite is so careful never to touch permanently
 * (see tests/db/helpers.ts's module doc comment). That would be unsafe.
 *
 * So the split is:
 *   - the DECISION logic (is this session valid right now, given its
 *     revoked/expired/idle timestamps) is pure TypeScript
 *     (`modules/auth/domain/session-policy.ts#checkSessionLifecycle`) and
 *     is unit-tested exhaustively in tests/unit/auth-session-policy.test.ts
 *     -- no DB needed for that part at all.
 *   - what THIS file proves is what only Postgres can prove: that the new
 *     SECURITY DEFINER bootstrap function resolves the right tenant (and
 *     is actually callable by fsj_app), and that the raw column shapes for
 *     an expired/revoked/suspended-user session are exactly what
 *     `validateSession`'s queries (and `checkSessionLifecycle`) expect to
 *     read.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, asApp, inRollbackTx, expectDbRejection } from "./helpers";

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

/** A regular (non-SISTEMA) usuario with a real role, in a given estado (walked through legal transitions). */
async function createUsuario(tx: Client, tenantId: string, sistemaId: string, suffix: string, estado: "ACTIVO" | "SUSPENDIDO"): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, `${suffix}-${Date.now()}@example.com`, `D-${suffix}`, sistemaId],
  );
  const rolId = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'FARMACEUTICO'`);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rolId.rows[0].id,
    sistemaId,
  ]);
  await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [id]);
  if (estado === "SUSPENDIDO") {
    await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [id]);
  }
  return id;
}

function rawTokenHash(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  return { rawToken, tokenHash };
}

async function insertSesion(
  tx: Client,
  tenantId: string,
  usuarioId: string,
  tokenHash: string,
  opts: { expiraEn?: Date; revocadaEn?: Date } = {},
): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en, revocada_en)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, usuarioId, tokenHash, opts.expiraEn ?? new Date(Date.now() + 12 * 60 * 60 * 1000), opts.revocadaEn ?? null],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("fsj.sesion_resolve_tenant (migration 0009)", () => {
  it("resolves the correct tenant_id for an existing, otherwise-valid session", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "resolve-ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, sistema, tokenHash);

        const result = await tx.query(`SELECT fsj.sesion_resolve_tenant($1) AS tenant_id`, [tokenHash]);
        expect(result.rows[0].tenant_id).toBe(tenantId);
      }),
    );
  });

  it("returns NULL for a token_hash that does not exist", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT fsj.sesion_resolve_tenant($1) AS tenant_id`, [`hash-${randomUUID()}`]);
        expect(result.rows[0].tenant_id).toBeNull();
      }),
    );
  });

  it("still resolves the tenant for a REVOKED session (the function only bootstraps tenant -- validity is checked afterwards by the app, not by this function)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "resolve-revoked");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, sistema, tokenHash, { revocadaEn: new Date() });

        const result = await tx.query(`SELECT fsj.sesion_resolve_tenant($1) AS tenant_id`, [tokenHash]);
        expect(result.rows[0].tenant_id).toBe(tenantId);
      }),
    );
  });

  it("still resolves the tenant for an EXPIRED session (same reasoning as revoked, above)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "resolve-expired");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        // creada_en/expira_en both backdated so the expira_en > creada_en CHECK still holds.
        await tx.query(
          `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, creada_en, ultimo_uso_en, expira_en)
           VALUES ($1, $2, $3, now() - interval '48 hours', now() - interval '48 hours', now() - interval '1 hour')`,
          [tenantId, sistema, tokenHash],
        );

        const result = await tx.query(`SELECT fsj.sesion_resolve_tenant($1) AS tenant_id`, [tokenHash]);
        expect(result.rows[0].tenant_id).toBe(tenantId);
      }),
    );
  });

  it("fsj_app has EXECUTE on the function (permission check only -- no fixture data needed)", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        // A made-up hash: if EXECUTE were not granted this would reject
        // with a permission error (42501) instead of returning a row.
        const result = await tx.query(`SELECT fsj.sesion_resolve_tenant($1) AS tenant_id`, [`no-such-hash-${randomUUID()}`]);
        expect(result.rows[0].tenant_id).toBeNull();
      }),
    );
  });

  it("fsj_app cannot call arbitrary SECURITY DEFINER-adjacent things -- EXECUTE is scoped to this one function, not a general RLS bypass (fsj_app still has NOBYPASSRLS)", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        // A direct SELECT on fsj.sesion (not through the function) without
        // app.tenant_id set must still see nothing -- ordinary RLS, not
        // touched by this migration.
        const result = await tx.query(`SELECT count(*)::int AS n FROM fsj.sesion`);
        expect(result.rows[0].n).toBe(0);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("session lifecycle raw data shapes (validateSession's inputs)", () => {
  it("an expired session round-trips with expira_en in the past and revocada_en NULL -- exactly what checkSessionLifecycle needs to classify it ABSOLUTE_EXPIRED", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "expired-shape");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        await tx.query(
          `INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, creada_en, ultimo_uso_en, expira_en)
           VALUES ($1, $2, $3, now() - interval '48 hours', now() - interval '48 hours', now() - interval '1 hour')`,
          [tenantId, sistema, tokenHash],
        );
        const row = await tx.query(`SELECT expira_en, ultimo_uso_en, revocada_en FROM fsj.sesion WHERE token_hash = $1`, [tokenHash]);
        expect(new Date(row.rows[0].expira_en).getTime()).toBeLessThan(Date.now());
        expect(row.rows[0].revocada_en).toBeNull();
      }),
    );
  });

  it("a revoked session round-trips with revocada_en set -- exactly what checkSessionLifecycle needs to classify it REVOKED", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "revoked-shape");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, sistema, tokenHash, { revocadaEn: new Date() });
        const row = await tx.query(`SELECT revocada_en FROM fsj.sesion WHERE token_hash = $1`, [tokenHash]);
        expect(row.rows[0].revocada_en).not.toBeNull();
      }),
    );
  });

  it("a session belonging to a SUSPENDIDO usuario round-trips with usuario.estado = 'SUSPENDIDO' -- exactly what requireSession's ACTIVO check needs to reject it", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "suspendido-shape");
        const sistema = await createSistemaUser(tx, tenantId);
        // The session is opened while ACTIVO (INV-U07, migration 0023: a
        // session can only ever be INSERTed for an ACTIVO usuario --
        // decideLogin's 'OK' branch is the only caller of insertSesionInTx
        // and it already requires estado === 'ACTIVO'), then the usuario is
        // suspended AFTERWARDS, same as every other "still-open session
        // outlives its owner's suspension" scenario in this codebase
        // (tests/db/designacion-dt.test.ts, cierre-diario.test.ts,
        // libro-recetario.test.ts, partidas-movimientos-stock.test.ts all
        // designate/authorize while ACTIVO, then suspend). This is exactly
        // what requireSession needs to reject on the NEXT request, not
        // something login() could ever produce directly.
        const usuarioId = await createUsuario(tx, tenantId, sistema, "susp", "ACTIVO");
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, usuarioId, tokenHash);
        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [usuarioId]);

        const row = await tx.query(
          `SELECT u.estado FROM fsj.sesion s JOIN fsj.usuario u ON u.id = s.usuario_id WHERE s.token_hash = $1`,
          [tokenHash],
        );
        expect(row.rows[0].estado).toBe("SUSPENDIDO");
      }),
    );
  });

  it("a session belonging to an ACTIVO usuario round-trips with usuario.estado = 'ACTIVO' (the happy path, for contrast)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "activo-shape");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuarioId = await createUsuario(tx, tenantId, sistema, "act", "ACTIVO");
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, usuarioId, tokenHash);

        const row = await tx.query(
          `SELECT u.estado FROM fsj.sesion s JOIN fsj.usuario u ON u.id = s.usuario_id WHERE s.token_hash = $1`,
          [tokenHash],
        );
        expect(row.rows[0].estado).toBe("ACTIVO");
      }),
    );
  });

  it("a session's tenant can have fecha_baja set -- exactly what requireSession's tenant check needs to reject it", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "baja-shape");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, sistema, tokenHash);
        await tx.query(`UPDATE fsj.tenant SET fecha_baja = now() WHERE id = $1`, [tenantId]);

        const row = await tx.query(`SELECT fecha_baja FROM fsj.tenant WHERE id = $1`, [tenantId]);
        expect(row.rows[0].fecha_baja).not.toBeNull();
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("fsj.sesion column-level guarantees FASE 2 relies on", () => {
  it("only ultimo_uso_en / revocada_en / reautenticada_en are UPDATE-able by fsj_app -- expira_en is fixed at creation (touchSession must never move it)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "grant-check");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, sistema, tokenHash);

        const result = await tx.query(
          `SELECT grantee, string_agg(column_name, ',' ORDER BY column_name) AS cols
           FROM information_schema.column_privileges
           WHERE table_schema = 'fsj' AND table_name = 'sesion' AND privilege_type = 'UPDATE' AND grantee = 'fsj_app'
           GROUP BY grantee`,
        );
        expect(result.rows[0].cols).toBe("reautenticada_en,revocada_en,ultimo_uso_en");
      }),
    );
  });

  it("a rolled-back sesion insert leaves no row behind (this suite's own safety net, exercised against sesion specifically)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "rb-sesion");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();

        await tx.query("SAVEPOINT sp_sesion");
        const sesionId = await insertSesion(tx, tenantId, sistema, tokenHash);
        await tx.query("ROLLBACK TO SAVEPOINT sp_sesion");

        const result = await tx.query(`SELECT 1 FROM fsj.sesion WHERE id = $1`, [sesionId]);
        expect(result.rows).toHaveLength(0);
      }),
    );
  });

  it("sesion rows are never deleted by the app -- fsj_app has no DELETE grant on fsj.sesion", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "no-delete");
        const sistema = await createSistemaUser(tx, tenantId);
        const { tokenHash } = rawTokenHash();
        await insertSesion(tx, tenantId, sistema, tokenHash);

        const result = await tx.query(
          `SELECT 1 FROM information_schema.table_privileges
           WHERE table_schema = 'fsj' AND table_name = 'sesion' AND privilege_type = 'DELETE' AND grantee = 'fsj_app'`,
        );
        expect(result.rows).toHaveLength(0);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("audit row atomicity for M02-shaped writes (shared/usecase.ts's contract)", () => {
  it("an audit row for a sesion-related action (e.g. ACTIVAR_CUENTA) written in a savepoint disappears when that savepoint rolls back -- the exact guarantee shared/usecase.ts's defineCommand relies on when the transaction it opened fails after the handler ran", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "audit-atomic");
        const sistema = await createSistemaUser(tx, tenantId);

        await tx.query("SAVEPOINT sp_audit_sesion");
        const row = await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion)
           VALUES ($1, $2, 'sesion', $2, 'ACTIVAR_CUENTA') RETURNING id`,
          [tenantId, sistema],
        );
        await tx.query("ROLLBACK TO SAVEPOINT sp_audit_sesion");

        const result = await tx.query(`SELECT 1 FROM fsj.registro_auditoria WHERE id = $1`, [row.rows[0].id]);
        expect(result.rows).toHaveLength(0);
      }),
    );
  });
});

// Sanity check that expectDbRejection stays imported/used (keeps the
// import from going stale if the file is trimmed later) -- also a real
// assertion: a session's expira_en must be after creada_en even when the
// row is constructed exactly the way this file's helpers do it.
describe.skipIf(dbTestSkipReason() !== null)("sesion CHECK constraints still apply to rows built the way this file builds them", () => {
  it("rejects expira_en <= creada_en", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "check-expira");
        const sistema = await createSistemaUser(tx, tenantId);
        await expectDbRejection(
          tx,
          () =>
            tx.query(`INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en) VALUES ($1, $2, $3, now() - interval '1 minute')`, [
              tenantId,
              sistema,
              `bad-${randomUUID()}`,
            ]),
          "23514",
        );
      }),
    );
  });
});
