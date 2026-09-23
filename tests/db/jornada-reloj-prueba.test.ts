/**
 * DB tests for prisma/migrations/.../0024_jornada_reloj_de_prueba and
 * .../0026_instante_actual: the fsj.reloj_prueba override hook itself.
 *
 * fsj.instante_actual() (migration 0026) resolves the current instant,
 * honouring current_setting('fsj.reloj_prueba', true) ONLY when that GUC is
 * non-empty AND session_user <> 'fsj_app'; otherwise it returns the real
 * now(). fsj.jornada_actual(uuid) delegates to it (see
 * tests/db/libro-recetario.test.ts's "fsj.jornada_actual delegates to..."
 * test for that half). This file tests fsj.instante_actual() directly --
 * see its migration 0026's header for why: it needs NO fsj.tenant row,
 * which is what makes the cross-connection security test below possible at
 * all without ever committing anything to the real database.
 *
 * See tests/db/helpers.ts for the rollback-transaction safety model
 * (inRollbackTx) and setRelojPrueba.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asApp, asOwner, inRollbackTx, setRelojPrueba } from "./helpers";

/** Asserts `actual` (a Date) is within `toleranceMs` of `reference` (a Date). */
function expectCloseTo(actual: Date, reference: Date, toleranceMs: number): void {
  const diff = Math.abs(actual.getTime() - reference.getTime());
  expect(diff, `expected ${actual.toISOString()} to be within ${toleranceMs}ms of ${reference.toISOString()}, was ${diff}ms off`).toBeLessThanOrEqual(
    toleranceMs,
  );
}

describe.skipIf(dbTestSkipReason() !== null)("0024/0026 fsj.reloj_prueba override (fsj schema)", () => {
  it("as owner, the override is honoured", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2001-01-01T00:00:00Z");
        const r = await tx.query(`SELECT fsj.instante_actual() AS instante`);
        expect(new Date(r.rows[0].instante as string).toISOString()).toBe("2001-01-01T00:00:00.000Z");
      }),
    );
  });

  it("as owner, the override is STILL honoured after SET LOCAL ROLE fsj_app (this is what tests/db/*.test.ts relies on)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2001-01-01T00:00:00Z");
        await tx.query("SET LOCAL ROLE fsj_app");
        // session_user is STILL 'postgres' here (SET ROLE never changes it,
        // only current_user) -- see migration 0026's header. The guard
        // reads session_user, so the override must still apply.
        const r = await tx.query(`SELECT fsj.instante_actual() AS instante`);
        expect(new Date(r.rows[0].instante as string).toISOString()).toBe("2001-01-01T00:00:00.000Z");
      }),
    );
  });

  it("an empty or unset fsj.reloj_prueba gives the real now()", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // Unset: setRelojPrueba was never called in this transaction.
        const before1 = new Date();
        const r1 = await tx.query(`SELECT fsj.instante_actual() AS instante`);
        expectCloseTo(new Date(r1.rows[0].instante as string), before1, 60_000);

        // Explicitly set to an empty string -- must ALSO fall through to now(),
        // not throw trying to cast '' to timestamptz.
        await setRelojPrueba(tx, "");
        const before2 = new Date();
        const r2 = await tx.query(`SELECT fsj.instante_actual() AS instante`);
        expectCloseTo(new Date(r2.rows[0].instante as string), before2, 60_000);
      }),
    );
  });

  it(
    "SECURITY: a real fsj_app session (asApp/DATABASE_URL) ignores fsj.reloj_prueba and gets the REAL instant -- " +
      "this test MUST fail if the session_user guard is removed from fsj.instante_actual() (migration 0026)",
    async () => {
      await asApp((client) =>
        inRollbackTx(client, async (tx) => {
          // Empirically verified (see migration 0026's header): a genuine
          // DATABASE_URL/pooler connection has session_user EXACTLY
          // 'fsj_app' (no project-ref qualification). If the guard
          // (`session_user <> 'fsj_app'`) were removed or weakened, this
          // session's override WOULD apply, and fsj.instante_actual() would
          // return 2001-01-01 (obviously not "close to now" and not this
          // year) instead of the real now() -- failing both assertions
          // below. That is the whole point of this test.
          await setRelojPrueba(tx, "2001-01-01T00:00:00Z");
          const before = new Date();
          const r = await tx.query(`SELECT fsj.instante_actual() AS instante`);
          const after = new Date();

          const instante = new Date(r.rows[0].instante as string);
          expectCloseTo(instante, before, Math.max(60_000, after.getTime() - before.getTime() + 60_000));
          expect(instante.getUTCFullYear()).not.toBe(2001);
        }),
      );
    },
  );
});
