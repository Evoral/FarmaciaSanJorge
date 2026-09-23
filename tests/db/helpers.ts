/**
 * Raw `pg` helpers for tests/db/**. Deliberately NOT using Prisma here --
 * these tests verify what the DATABASE itself enforces (roles, RLS,
 * triggers), independent of whether the app code that would normally sit
 * on top of it has any bugs.
 *
 * SAFETY: there is only one Supabase database (DATABASE_URL/DIRECT_URL,
 * the same one the app uses) -- no separate test project exists yet.
 * `inRollbackTx` is the safety net: every DB test MUST do all of its work
 * inside it, so nothing -- not even DDL -- ever survives past the test
 * (Postgres DDL is transactional, so `CREATE TABLE` inside a rolled-back
 * transaction leaves zero trace). Revisit before production go-live:
 * provision a dedicated test/staging Supabase project instead.
 *
 * THE ABORTED-TRANSACTION RULE (read this before writing a test that
 * expects a query to fail):
 *
 *   In Postgres, once ANY statement inside a transaction raises an error,
 *   the ENTIRE transaction is marked aborted (SQLSTATE 25P02) and every
 *   subsequent statement on that transaction fails with "current
 *   transaction is aborted, commands ignored until end of transaction
 *   block" -- until a ROLLBACK or a ROLLBACK TO SAVEPOINT runs. There is
 *   no per-statement recovery without one.
 *
 *   `inRollbackTx` wraps each test in exactly one `BEGIN ... ROLLBACK`,
 *   with NO savepoints of its own. That means a naive
 *   `await expect(tx.query(...)).rejects.toThrow()` in the middle of a
 *   test is a trap:
 *     - Any query the test runs AFTER that point fails too, even if the
 *       invariant it's meant to exercise is fine -- the test either
 *       explodes with an unrelated "transaction is aborted" error, or
 *       (worse) silently "passes" a second rejection assertion for the
 *       wrong reason, providing false coverage for whatever it actually
 *       meant to check.
 *
 *   The fix is `inSavepoint` (below): it wraps a block in its own
 *   `SAVEPOINT`, and unconditionally rolls back to (and releases) that
 *   savepoint afterwards, regardless of whether the block succeeded or
 *   threw. That undoes the aborted-transaction state (and any effects of
 *   the block) while leaving the OUTER `inRollbackTx` transaction healthy
 *   and ready for more queries. `expectInvariantViolation` and
 *   `expectDbRejection` are built on top of it -- prefer them over a bare
 *   `.rejects.toThrow()` so:
 *     (a) a query that unexpectedly succeeds is caught,
 *     (b) the error is checked against the SPECIFIC invariant code or
 *         SQLSTATE the test claims to exercise (not just "it threw
 *         something"), and
 *     (c) the rest of the test keeps running normally afterwards.
 */
import { Client } from "pg";
import { expect } from "vitest";
import { requireDbTestEnv } from "./env";

/** Runs `fn` with a client connected as the migration owner (DIRECT_URL). */
/**
 * Connections are cached per role for the lifetime of the test worker.
 *
 * Why: opening one connection per test saturates the Supabase pooler --
 * a full run churns through 120+ logins and intermittently fails with
 * EAUTHTIMEOUT. Reuse is safe here because db tests run sequentially
 * (vitest.config.ts) and every test wraps its work in inRollbackTx, so
 * no session state (SET LOCAL, role, app.tenant_id) survives a test.
 */
const cachedClients = new Map<string, Client>();

async function connectionFor(key: "owner" | "app", connectionString: string): Promise<Client> {
  const existing = cachedClients.get(key);
  if (existing) return existing;
  const client = new Client({ connectionString });
  // If the pooler drops this connection, evict it so the NEXT test opens a
  // fresh one. Without this, one network drop poisons every later test in
  // the file with "Client has encountered a connection error". The test
  // that was running when the drop happened still fails -- as it should.
  const evict = () => {
    if (cachedClients.get(key) === client) cachedClients.delete(key);
  };
  client.on("error", evict);
  client.on("end", evict);
  await client.connect();
  if (key === "owner") {
    // The owner connection goes through the Supabase SESSION pooler, so a
    // session-level SET sticks. If this client drops mid-test, the server
    // keeps the backend (and its open transaction and locks) alive; with
    // this timeout Postgres terminates it after 20s, before the next test's
    // wait on those locks reaches the 30s test timeout. The app connection
    // (transaction pooler) gets the same protection from fsj_app's role
    // defaults set by scripts/db-bootstrap.ts.
    await client.query("SET idle_in_transaction_session_timeout = '20s'");
  }
  cachedClients.set(key, client);
  return client;
}

/** Closes the cached connections; registered as a vitest teardown hook. */
export async function closeTestConnections(): Promise<void> {
  const clients = [...cachedClients.values()];
  cachedClients.clear();
  await Promise.all(clients.map((client) => client.end()));
}

/**
 * Connection-level failures only: the Supabase pooler dropping the socket,
 * or timing out the auth handshake on reconnect. These say nothing about
 * the schema under test. Assertion failures and database errors raised by
 * our own invariants (SQLSTATE P0001, 23xxx, 42501, ...) are deliberately
 * NOT in this list, so they are never retried.
 */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && (/^08/.test(code) || code === "57P01" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE")) {
    return true;
  }
  return (
    /EAUTHTIMEOUT/.test(error.message) ||
    /Client has encountered a connection error and is not queryable/.test(error.message) ||
    /Connection terminated/.test(error.message) ||
    /Client was closed and is not queryable/.test(error.message)
  );
}

/**
 * Runs `fn` on the cached connection for `key`. If it fails with a
 * CONNECTION error, the dead client is evicted and `fn` runs exactly once
 * more on a fresh connection.
 *
 * Why retrying is safe: every DB test does all its work inside
 * `inRollbackTx`, so nothing from the failed attempt persists and the
 * second attempt starts from the same clean state. Why it cannot hide a
 * real bug: only connection-class errors are retried (see
 * `isConnectionError`); a test that fails because an invariant is wrong
 * fails on the first attempt and is reported as a failure. A retry is
 * logged loudly so repeated pooler trouble stays visible.
 */
async function runWithConnectionRetry<T>(
  key: "owner" | "app",
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await connectionFor(key, connectionString));
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    const stale = cachedClients.get(key);
    cachedClients.delete(key);
    await stale?.end().catch(() => undefined);
    console.warn(`[tests/db] ${key} connection failed (${(error as Error).message}); retrying the test once on a fresh connection`);
    return fn(await connectionFor(key, connectionString));
  }
}

export async function asOwner<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const { directUrl } = requireDbTestEnv();
  return runWithConnectionRetry("owner", directUrl, fn);
}

export async function asApp<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const { databaseUrl } = requireDbTestEnv();
  return runWithConnectionRetry("app", databaseUrl, fn);
}

/** Runs `fn` with a client connected as the runtime role (DATABASE_URL, fsj_app). */


export interface RollbackTxOptions {
  /**
   * Set when the test needs to exercise a DEFERRABLE constraint that
   * would otherwise only be checked at COMMIT time -- which never happens
   * here, since `inRollbackTx` always rolls back. Runs
   * `SET CONSTRAINTS ALL IMMEDIATE` right after `BEGIN`.
   */
  setConstraintsImmediate?: boolean;
}

/**
 * Runs `fn` inside `BEGIN ... ROLLBACK`. The rollback runs unconditionally
 * (success or failure, in a `finally`), so nothing `fn` does -- inserts,
 * updates, `CREATE TABLE`, `CREATE TRIGGER`, `GRANT`, all of it -- ever
 * persists to the real database. This is THE safety mechanism for every
 * DB test in this suite; see the module doc comment above.
 *
 * Has NO savepoints of its own -- see the aborted-transaction rule above.
 * A test that needs to assert a query rejects and then keep using the
 * transaction MUST do so via `inSavepoint` / `expectInvariantViolation` /
 * `expectDbRejection`, not a bare `.rejects.toThrow()`.
 *
 * Does not manage `app.tenant_id` -- compose with `withTenant` for that.
 */
export async function inRollbackTx<T>(
  client: Client,
  fn: (client: Client) => Promise<T>,
  options: RollbackTxOptions = {},
): Promise<T> {
  await client.query("BEGIN");
  try {
    if (options.setConstraintsImmediate) {
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    }
    return await fn(client);
  } finally {
    // Unconditional: ROLLBACK even if fn() succeeded. DB tests never commit.
    await client.query("ROLLBACK");
  }
}

/**
 * Sets `app.tenant_id` to `tenantId` for the CURRENT transaction (mirrors
 * `shared/db/transaction.ts#withTenantTransaction`, but against a raw
 * `pg` client so DB tests don't depend on Prisma being correct).
 *
 * Assumes the caller already opened a transaction -- normally by wrapping
 * this call in `inRollbackTx`, e.g.:
 *   asApp((client) => inRollbackTx(client, (tx) => withTenant(tx, tenantId, fn)))
 * Does NOT begin/commit/rollback on its own; it never commits anything.
 */
export async function withTenant<T>(
  client: Client,
  tenantId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  return fn(client);
}

/**
 * Pins "now" for `fsj.jornada_actual()` (prisma/migrations/.../0024_jornada_reloj_de_prueba)
 * to `isoInstant` for the CURRENT transaction only -- `set_config(..., true)`
 * is transaction-local, so it is automatically undone by `inRollbackTx`'s
 * ROLLBACK, exactly like everything else a DB test does.
 *
 * Replaces the old "jump tenant.zona_horaria between extreme IANA zones"
 * technique (Etc/GMT+12 <-> Pacific/Kiritimati) that used to fake "yesterday
 * vs. today": the calendar distance between those zones' local dates
 * depends on the UTC hour the test happens to run at, which made every test
 * using it non-deterministic near UTC day boundaries. Pin explicit instants
 * instead, e.g.:
 *   await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00"); // day D
 *   ... create/sign things for day D ...
 *   await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00"); // day D+1
 *   ... day D is now in the past ...
 *
 * SECURITY: this override only takes effect for a session whose
 * session_user is NOT `fsj_app` (see migration 0024's header for the full
 * argument) -- it works here because `asOwner` connects as the owner
 * (`postgres`), and `SET LOCAL ROLE fsj_app` (used by `withTenant`-adjacent
 * tests to exercise RLS/grants) changes `current_user` but never
 * `session_user`. A genuine `asApp`/DATABASE_URL connection (session_user
 * IS `fsj_app`) always ignores this override -- see
 * tests/db/jornada-reloj-prueba.test.ts.
 */
export async function setRelojPrueba(client: Client, isoInstant: string): Promise<void> {
  await client.query("SELECT set_config('fsj.reloj_prueba', $1, true)", [isoInstant]);
}

/**
 * Creates a savepoint-name generator: each call to the returned function
 * returns a new name of the form `<prefix>_<n>`, unique for the lifetime
 * of that generator. Factored out as a plain, side-effect-free-per-call
 * closure (rather than a single shared module counter) so it's trivially
 * unit-testable -- see tests/unit/db-helpers.test.ts -- and so nested
 * `inSavepoint` calls sharing one generator can never collide regardless
 * of nesting depth or how many savepoints were opened and released
 * before them.
 */
export function createSavepointNameGenerator(prefix = "sp"): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}_${counter}`;
  };
}

/**
 * Single generator shared by every `inSavepoint` call in the process.
 * Monotonically increasing, so names stay unique across concurrent
 * nesting depths and across savepoints already released -- Postgres
 * savepoint names only need to be unique among currently-open savepoints
 * in the same transaction, but a process-wide counter is simplest and is
 * always safe, nested or not.
 */
const nextSavepointName = createSavepointNameGenerator();

/**
 * Runs `fn` inside a uniquely named `SAVEPOINT` nested in the current
 * transaction. In a `finally`, UNCONDITIONALLY issues
 * `ROLLBACK TO SAVEPOINT <name>` followed by `RELEASE SAVEPOINT <name>` --
 * regardless of whether `fn` succeeded, threw, or aborted the transaction
 * (Postgres SQLSTATE 25P02; see the aborted-transaction rule in the module
 * doc comment).
 *
 * Note this means `inSavepoint` discards EVERY effect of `fn`, including
 * ones from a `fn` that completed successfully -- it is not a generic
 * "nested transaction that commits on success" primitive, it is the
 * building block for assertion helpers (`expectInvariantViolation`,
 * `expectDbRejection`) that need to attempt a statement, observe whether
 * it failed, and guarantee the outer transaction is unaffected either way.
 *
 * `ROLLBACK TO SAVEPOINT` works even when the transaction is currently
 * aborted (that's the whole point -- it's the one command Postgres still
 * accepts in that state), so this always leaves the OUTER transaction
 * healthy and ready for more queries, however badly `fn` failed.
 *
 * Nests safely: each call gets its own name from a shared, monotonically
 * increasing counter (`createSavepointNameGenerator`), so an `inSavepoint`
 * called from within another `inSavepoint`'s `fn` never collides with it.
 */
export async function inSavepoint<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  const name = nextSavepointName();
  await client.query(`SAVEPOINT ${name}`);
  try {
    return await fn();
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  }
}

interface PgErrorLike {
  message: string;
  code?: string;
}

function isPgErrorLike(e: unknown): e is PgErrorLike {
  return typeof e === "object" && e !== null && "message" in e;
}

/**
 * Asserts that calling `thunk` rejects with a Postgres error raised as
 * `INV-<code>: ...` with SQLSTATE P0001 (the convention every invariant
 * trigger in this codebase follows -- see the migration.sql files under
 * prisma/migrations/).
 *
 * Runs `thunk` inside `inSavepoint`, so:
 *   - if `thunk` unexpectedly resolves, that's caught below and the
 *     savepoint still unwinds, leaving `tx` usable;
 *   - if `thunk` rejects (the expected case), the failed statement's
 *     effects (and the aborted-transaction state it leaves behind) are
 *     undone by the time this returns, so the caller can keep using `tx`
 *     for further queries/assertions in the same test.
 *
 * For a plain constraint violation (CHECK/UNIQUE/FK/privilege) that does
 * NOT carry an `INV-XXX` token in its message, use `expectDbRejection`
 * instead and assert on the SQLSTATE.
 */
export async function expectInvariantViolation(
  tx: Client,
  thunk: () => Promise<unknown>,
  invariantCode: string,
): Promise<void> {
  await inSavepoint(tx, async () => {
    let caught: unknown;
    try {
      await thunk();
    } catch (e) {
      caught = e;
    }

    expect(caught, `Expected the statement to reject with ${invariantCode}, but it resolved.`).toBeDefined();
    if (!isPgErrorLike(caught)) {
      throw new Error(`Expected a Postgres-style error, got: ${String(caught)}`);
    }
    expect(caught.message).toContain(invariantCode);
    if (caught.code !== undefined) {
      expect(caught.code).toBe("P0001");
    }
  });
}

/**
 * Asserts that calling `thunk` rejects with a Postgres error carrying the
 * given SQLSTATE -- for plain constraint-level rejections that have no
 * `INV-XXX` token in their message: 23514 (CHECK), 23505 (unique),
 * 23503 (foreign key), 23502 (not null), 23P01 (exclusion), 42501
 * (insufficient privilege / RLS policy violation), etc.
 *
 * Same savepoint-backed semantics as `expectInvariantViolation` above --
 * see that function's doc comment and the module-level aborted-transaction
 * rule for why this matters.
 */
export async function expectDbRejection(tx: Client, thunk: () => Promise<unknown>, sqlstate: string): Promise<void> {
  await inSavepoint(tx, async () => {
    let caught: unknown;
    try {
      await thunk();
    } catch (e) {
      caught = e;
    }

    expect(caught, `Expected the statement to reject with SQLSTATE ${sqlstate}, but it resolved.`).toBeDefined();
    if (!isPgErrorLike(caught)) {
      throw new Error(`Expected a Postgres-style error, got: ${String(caught)}`);
    }
    expect(caught.code).toBe(sqlstate);
  });
}
