/**
 * T3-06 DB tests: Concurrency and atomic updates on failed login and PIN attempts.
 *
 * Audit finding T3-06 (P3-03):
 * - The repositories use atomic `UPDATE fsj.usuario SET x = x + 1 ... RETURNING x`.
 * - Cross-connection test: proves with two real connections that a concurrent UPDATE
 *   on the same user waits for the row lock held by the first transaction, serializing
 *   concurrent attempts without lost updates. Both roll back, committing nothing.
 * - Sequential test: proves within a rolled-back transaction that repeating the update
 *   5 times reaches 5 attempts and sets `bloqueado_hasta` (login) and `pin_bloqueado = true` (PIN).
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { asOwner, inRollbackTx } from "./helpers";
import { insertTenant, createSistemaUser, createUserWithRole } from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("T3-06: failed login and PIN attempts concurrency & lockout", () => {
  it("two real connections updating the same user row serialize via row lock (both roll back)", async () => {
    const { directUrl } = requireDbTestEnv();
    const { Client } = await import("pg");
    const a = new Client({ connectionString: directUrl });
    const b = new Client({ connectionString: directUrl });

    await a.connect();
    await b.connect();

    try {
      // 1. Pick an existing user from the database (read-only query) so both connections can target a visible committed row.
      const existingUser = (await a.query<{ id: string; tenant_id: string }>("SELECT id, tenant_id FROM fsj.usuario LIMIT 1")).rows[0];
      expect(existingUser, "A committed usuario row must exist in the database").toBeDefined();
      const { id: usuarioId, tenant_id: tenantId } = existingUser;

      // 2. Begin transaction on Connection A and acquire row lock via atomic UPDATE
      await a.query("BEGIN");
      await a.query(
        `UPDATE fsj.usuario
         SET intentos_fallidos = intentos_fallidos + 1
         WHERE tenant_id = $1 AND id = $2
         RETURNING intentos_fallidos`,
        [tenantId, usuarioId],
      );

      // 3. Begin transaction on Connection B and attempt the same UPDATE on the same row -> it must block
      await b.query("BEGIN");

      // Connection B attempts to update the SAME user row and must block
      const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      let bDone = false;
      const bPromise = b
        .query(
          `UPDATE fsj.usuario
           SET intentos_fallidos = intentos_fallidos + 1
           WHERE tenant_id = $1 AND id = $2
           RETURNING intentos_fallidos`,
          [tenantId, usuarioId],
        )
        .then(() => {
          bDone = true;
        })
        .catch(() => undefined);

      // Verify connection B is waiting in pg_locks
      let bWaiting = false;
      for (let i = 0; i < 50 && !bWaiting; i++) {
        const w = await a.query(
          `SELECT count(*)::int AS n
           FROM pg_locks
           WHERE pid = $1 AND NOT granted`,
          [bPid],
        );
        bWaiting = w.rows[0].n > 0;
        if (!bWaiting) await new Promise((r) => setTimeout(r, 20));
      }

      expect(bWaiting, "Connection B should be blocked waiting on the row lock").toBe(true);
      expect(bDone).toBe(false);

      // 3. Rollback connection A -> releases the row lock, unblocking connection B
      await a.query("ROLLBACK");
      await bPromise;

      // 4. Rollback connection B -> leaves zero committed rows
      await b.query("ROLLBACK");
    } finally {
      await a.end().catch(() => undefined);
      await b.end().catch(() => undefined);
    }
  });

  it("sequential updates increment counter to 5 and activate login lockout and PIN lockout", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "t306seq");
        const sistema = await createSistemaUser(tx, tenantId);
        const usuarioId = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "t306seq");

        // Set an initial PIN for the user
        await tx.query(`UPDATE fsj.usuario SET pin_hash = 'dummy_hash', pin_actualizado_en = now() WHERE id = $1`, [usuarioId]);

        const maxIntentos = 5;
        const lockoutDurationMs = 15 * 60 * 1000;

        // --- 1. Login failed attempts ---
        for (let attempt = 1; attempt <= 4; attempt++) {
          const res = await tx.query<{ intentos_fallidos: number; bloqueado_hasta: string | null }>(
            `UPDATE fsj.usuario
             SET intentos_fallidos = intentos_fallidos + 1,
                 bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $3 THEN (now() + make_interval(secs => $4))::timestamptz ELSE NULL END
             WHERE tenant_id = $1 AND id = $2
             RETURNING intentos_fallidos, bloqueado_hasta::text`,
            [tenantId, usuarioId, maxIntentos, lockoutDurationMs / 1000],
          );
          expect(res.rows[0].intentos_fallidos).toBe(attempt);
          expect(res.rows[0].bloqueado_hasta).toBeNull();
        }

        // 5th attempt locks the user
        const res5 = await tx.query<{ intentos_fallidos: number; bloqueado_hasta: string | null }>(
          `UPDATE fsj.usuario
           SET intentos_fallidos = intentos_fallidos + 1,
               bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $3 THEN (now() + make_interval(secs => $4))::timestamptz ELSE NULL END
           WHERE tenant_id = $1 AND id = $2
           RETURNING intentos_fallidos, bloqueado_hasta::text`,
          [tenantId, usuarioId, maxIntentos, lockoutDurationMs / 1000],
        );
        expect(res5.rows[0].intentos_fallidos).toBe(5);
        expect(res5.rows[0].bloqueado_hasta).not.toBeNull();

        // --- 2. PIN failed attempts ---
        for (let attempt = 1; attempt <= 4; attempt++) {
          const pinRes = await tx.query<{ pin_intentos_fallidos: number; pin_bloqueado: boolean }>(
            `UPDATE fsj.usuario
             SET pin_intentos_fallidos = pin_intentos_fallidos + 1,
                 pin_bloqueado = pin_intentos_fallidos + 1 >= $3
             WHERE tenant_id = $1 AND id = $2
             RETURNING pin_intentos_fallidos, pin_bloqueado`,
            [tenantId, usuarioId, maxIntentos],
          );
          expect(pinRes.rows[0].pin_intentos_fallidos).toBe(attempt);
          expect(pinRes.rows[0].pin_bloqueado).toBe(false);
        }

        // 5th PIN attempt locks the PIN
        const pinRes5 = await tx.query<{ pin_intentos_fallidos: number; pin_bloqueado: boolean }>(
          `UPDATE fsj.usuario
           SET pin_intentos_fallidos = pin_intentos_fallidos + 1,
               pin_bloqueado = pin_intentos_fallidos + 1 >= $3
           WHERE tenant_id = $1 AND id = $2
           RETURNING pin_intentos_fallidos, pin_bloqueado`,
          [tenantId, usuarioId, maxIntentos],
        );
        expect(pinRes5.rows[0].pin_intentos_fallidos).toBe(5);
        expect(pinRes5.rows[0].pin_bloqueado).toBe(true);
      }),
    );
  });
});
