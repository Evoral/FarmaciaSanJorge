/**
 * Password hashing (M02, plan §8: "contraseñas argon2id (@node-rs/argon2)").
 * Pure w.r.t. this app's I/O boundaries (no Prisma/Next/shared-db) -- the
 * native argon2 binding is CPU-bound work, not application I/O -- so this
 * lives in domain/ alongside token.ts, which draws the same line for
 * SHA-256 token hashing.
 *
 * `verifyPassword` ALWAYS performs a real argon2 verification, even when
 * `hashValue` is `null` (a PENDIENTE_ACTIVACION usuario has no password
 * yet) or the caller has no usuario row at all (unknown email) -- it
 * verifies against a lazily-computed DUMMY hash in that case, so the
 * argon2 work (and its cost, dominating the request's latency) is
 * constant regardless of which branch login() took. This is what keeps
 * "unknown email" and "wrong password" timing-indistinguishable (FASE 2
 * point 2.2: no enumeration vector) -- skipping the hash entirely for an
 * unknown email would make that branch measurably faster.
 */
import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

/** `argon2id` hash of `password`, using the library's default (id, cost) parameters. Never call with an already-hashed value. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

let dummyHashPromise: Promise<string> | null = null;

/** Computed once per process (see module doc comment) -- a real, validly-formed argon2id hash of a random, never-reused, never-logged value, used only so `verify()` always has a well-formed hash to run against. */
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash(randomBytes(32).toString("hex"));
  return dummyHashPromise;
}

/**
 * Verifies `password` against `hashValue`. When `hashValue` is `null`,
 * still runs a real argon2 verification against a dummy hash (see module
 * doc comment) and returns `false` -- it NEVER short-circuits to `false`
 * without doing the work, and never throws (a malformed hash is treated
 * as "does not match", not an application error).
 */
export async function verifyPassword(hashValue: string | null, password: string): Promise<boolean> {
  const target = hashValue ?? (await getDummyHash());
  try {
    return await verify(target, password);
  } catch {
    return false;
  }
}
