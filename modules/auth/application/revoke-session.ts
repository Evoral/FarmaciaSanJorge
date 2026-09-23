/**
 * Session revocation (M02, FASE 2 point 2.1). Both operate on an already
 * KNOWN `{tenantId, ...}` -- the normal caller is a logged-in request that
 * already ran `requireSession()` (logout: revoke your own session;
 * password change / suspend / baja / credential reset: revoke every
 * session for the affected usuario, INV-U08) -- so neither needs the raw
 * token / RLS-bootstrap dance `validateSession` does.
 *
 * Sessions are REVOKED, never deleted (migration 0004 comment: "preserve
 * an audit trail") -- these set `revocada_en`, they never `DELETE`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/shared/db/transaction";
import { revokeSesion, revokeAllSesionesForUsuario } from "../infrastructure/session-repository";

export async function revokeSession(tenantId: string, sesionId: string, now: Date = new Date()): Promise<void> {
  await withTenantTransaction(tenantId, (tx) => revokeSesion(tx, sesionId, now));
}

/** Returns the number of sessions revoked. */
export async function revokeAllSessionsForUser(tenantId: string, usuarioId: string, now: Date = new Date()): Promise<number> {
  return withTenantTransaction(tenantId, (tx) => revokeAllSesionesForUsuario(tx, tenantId, usuarioId, now));
}

/**
 * Same as `revokeAllSesionesForUsuario` (modules/auth/infrastructure/
 * session-repository.ts), re-exported through this module's `application/`
 * layer so OTHER modules (e.g. modules/usuarios's suspender/darDeBaja/
 * restablecerCredencial commands, FASE 3) can revoke sessions as part of
 * their OWN already-open transaction -- ESLint forbids any module outside
 * modules/auth from importing `modules/auth/infrastructure/**` directly
 * (eslint.config.mjs's appBoundaryPatterns), but `application/**` is a
 * legitimate cross-module dependency, same as reusing
 * modules/auth/domain/token.ts's token generation. Takes `tx` (not
 * `tenantId` alone) precisely so the revoke lands in the CALLER's
 * transaction instead of opening a second, independent one (which would
 * break atomicity with the caller's own estado/historial/credencial
 * writes -- see tests/db/auth-sessions.test.ts's module doc comment on why
 * Prisma transactions cannot nest here).
 */
export async function revokeAllSesionesForUsuarioInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  usuarioId: string,
  now: Date,
): Promise<number> {
  return revokeAllSesionesForUsuario(tx, tenantId, usuarioId, now);
}
