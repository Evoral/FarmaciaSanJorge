/**
 * T3-03 DB tests: Lock ordering across shared drug and excipient partidas.
 *
 * Audit finding T3-03 (P3-02):
 * - Reserving and confirming preparaciones sharing drug and excipient lots take locks in
 *   ONE single statement with `ORDER BY id ASC FOR UPDATE`.
 * - Cross-connection test: two real connections requesting the same set of partidas in
 *   opposite/crossed order (`[B, A]` vs `[A, B]`) do NOT produce a 40P01 deadlock because
 *   Postgres evaluates and locks tuples in deterministic ascending id order.
 * - Both connections roll back; nothing is committed to the shared database.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { dbTestSkipReason, requireDbTestEnv } from "./env";

describe.skipIf(dbTestSkipReason() !== null)("T3-03: single-statement id-ordered locks prevent 40P01 deadlocks", () => {
  it("two connections requesting partidas in crossed order do not deadlock", async () => {
    const { directUrl } = requireDbTestEnv();
    const a = new Client({ connectionString: directUrl });
    const b = new Client({ connectionString: directUrl });

    await a.connect();
    await b.connect();

    try {
      // 1. Pick 2 committed partidas from the database to target existing visible rows
      const rows = (await a.query<{ id: string; tenant_id: string }>("SELECT id, tenant_id FROM fsj.partida LIMIT 2")).rows;
      expect(rows.length).toBeGreaterThanOrEqual(2);

      const [partida1, partida2] = [rows[0].id, rows[1].id].sort();

      // 2. Both connections begin a transaction
      await a.query("BEGIN");
      await b.query("BEGIN");

      // Connection A executes lock query passing [partida2, partida1] (reverse order)
      const resA = await a.query<{ id: string }>(
        `SELECT id FROM fsj.partida
         WHERE id = ANY($1::uuid[])
         ORDER BY id ASC
         FOR UPDATE`,
        [[partida2, partida1]],
      );
      expect(resA.rows.map((r) => r.id)).toEqual([partida1, partida2]);

      // Connection B attempts lock query passing [partida1, partida2] (forward order)
      const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      let bDone = false;
      let bError: unknown = null;

      const bPromise = b
        .query<{ id: string }>(
          `SELECT id FROM fsj.partida
           WHERE id = ANY($1::uuid[])
           ORDER BY id ASC
           FOR UPDATE`,
          [[partida1, partida2]],
        )
        .then((r) => {
          bDone = true;
          return r;
        })
        .catch((err) => {
          bError = err;
        });

      // Verify connection B is waiting for connection A without deadlocking
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

      expect(bWaiting, "Connection B should wait on connection A's lock").toBe(true);
      expect(bDone).toBe(false);
      expect(bError).toBeNull();

      // 3. Rollback Connection A -> releases locks, letting Connection B finish cleanly
      await a.query("ROLLBACK");
      const resB = await bPromise;

      expect(bError).toBeNull();
      expect(resB?.rows.map((r) => r.id)).toEqual([partida1, partida2]);

      // 4. Rollback Connection B -> zero persistence
      await b.query("ROLLBACK");
    } finally {
      await a.end().catch(() => undefined);
      await b.end().catch(() => undefined);
    }
  });
});
