/**
 * Standalone idle-refresh entry point (M02, FASE 2 point 2.1). Normally
 * unnecessary to call directly -- `validateSession` already touches the
 * session as part of a successful validation -- but exposed for callers
 * that already hold a verified `{tenantId, sesionId}` (e.g. a long-running
 * background action within an already-`requireSession()`-checked request)
 * and want to extend the idle window without re-validating from a raw
 * token.
 *
 * SECURITY: this FAILS CLOSED. It re-reads the session and re-runs
 * `checkSessionLifecycle` before writing. Without that check, touching an
 * idle-expired session would reset its idle clock and bring it back to
 * life -- an idle-timeout bypass. The caller's "already verified" claim is
 * never trusted, because a session can be revoked or expire between the
 * check and this call.
 */
import { withTenantTransaction } from "@/shared/db/transaction";
import { checkSessionLifecycle } from "../domain/session-policy";
import { findSesionById, touchSesion } from "../infrastructure/session-repository";

/**
 * @returns true when the session was still valid and got touched, false
 *          when it was revoked or expired (in which case nothing is written).
 */
export async function touchSession(tenantId: string, sesionId: string, now: Date = new Date()): Promise<boolean> {
  return withTenantTransaction(tenantId, async (tx) => {
    const sesion = await findSesionById(tx, sesionId);
    if (sesion === null) return false;
    if (checkSessionLifecycle(sesion, now) !== null) return false;

    await touchSesion(tx, sesionId, now);
    return true;
  });
}
