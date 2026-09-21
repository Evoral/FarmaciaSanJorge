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
import { withTenantTransaction } from "@/shared/db/transaction";
import { revokeSesion, revokeAllSesionesForUsuario } from "../infrastructure/session-repository";

export async function revokeSession(tenantId: string, sesionId: string, now: Date = new Date()): Promise<void> {
  await withTenantTransaction(tenantId, (tx) => revokeSesion(tx, sesionId, now));
}

/** Returns the number of sessions revoked. */
export async function revokeAllSessionsForUser(tenantId: string, usuarioId: string, now: Date = new Date()): Promise<number> {
  return withTenantTransaction(tenantId, (tx) => revokeAllSesionesForUsuario(tx, tenantId, usuarioId, now));
}
