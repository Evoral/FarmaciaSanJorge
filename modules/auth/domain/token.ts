/**
 * Opaque session/credential token generation and hashing (M02, plan §8:
 * "sesiones opacas en BD (token aleatorio, hash SHA-256 en tabla)"). Pure --
 * only Node's `crypto` primitives, no Prisma/Next/shared-db -- so this lives
 * in domain/ and is unit-testable without any I/O.
 *
 * The raw token is what the client holds (session cookie / activation
 * link); only `hashToken(raw)` is ever persisted or looked up in
 * `fsj.sesion.token_hash` / `fsj.credencial_activacion.token_hash` --
 * mirrors the DB comment "token_hash stores the hash only (never the raw
 * token)" on both tables (migration 0004).
 */
import { randomBytes, createHash } from "node:crypto";

/** Number of random bytes in a generated token (256 bits of entropy). */
export const TOKEN_BYTE_LENGTH = 32;

/** A fresh opaque token: 32 random bytes, base64url-encoded (~43 chars, no padding, cookie/URL safe). */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

/**
 * SHA-256 hash of a raw token, hex-encoded -- the only form ever stored or
 * used in a `WHERE token_hash = ...` lookup. A fast hash (not argon2id) is
 * correct here: unlike a user-chosen password, the token itself already
 * has 256 bits of entropy, so there is no low-entropy secret to protect
 * against offline brute force -- only the DB row lookup, which an indexed
 * equality query already makes a non-issue (plan §8; "Timing: hash-then-
 * lookup is fine").
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
