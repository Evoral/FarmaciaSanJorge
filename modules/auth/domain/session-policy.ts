/**
 * Pure session lifetime rules (M02, DP-20-pending -- see
 * shared/auth/policy.ts for the actual timeout values). No I/O: every
 * function here takes timestamps in and returns a plain value out, so the
 * idle-vs-absolute expiry logic is unit-testable without a database.
 */
import { AUTH_POLICY } from "@/shared/auth/policy";

/** `expira_en` for a brand-new session: `creadaEn` + the absolute session lifetime. Fixed at creation time (migration 0004 comment) -- never recomputed. */
export function computeAbsoluteExpiry(creadaEn: Date): Date {
  return new Date(creadaEn.getTime() + AUTH_POLICY.sessionAbsoluteHours * 60 * 60 * 1000);
}

/** True once `now` is at or past the session's fixed absolute expiry. */
export function isAbsoluteExpired(expiraEn: Date, now: Date): boolean {
  return now.getTime() >= expiraEn.getTime();
}

/** True once `now` is more than the idle timeout past the session's last recorded use. */
export function isIdleExpired(ultimoUsoEn: Date, now: Date): boolean {
  return now.getTime() - ultimoUsoEn.getTime() > AUTH_POLICY.sessionIdleMinutes * 60 * 1000;
}

export interface SessionLifecycleRow {
  expiraEn: Date;
  ultimoUsoEn: Date;
  revocadaEn: Date | null;
}

export type SessionInvalidReason = "REVOKED" | "ABSOLUTE_EXPIRED" | "IDLE_EXPIRED";

/**
 * The single decision point for "is this session row still usable right
 * now": checked in this order (revocation first -- a revoked session is
 * invalid regardless of timing; absolute before idle since it is the
 * harder ceiling). Returns `null` when the session is valid, otherwise the
 * specific reason it is not -- callers (`validateSession`) don't need to
 * expose the reason to the client (a generic "session expired, please log
 * in again" is enough), but distinguishing it is what makes this testable
 * and debuggable from server logs.
 */
export function checkSessionLifecycle(session: SessionLifecycleRow, now: Date): SessionInvalidReason | null {
  if (session.revocadaEn !== null) return "REVOKED";
  if (isAbsoluteExpired(session.expiraEn, now)) return "ABSOLUTE_EXPIRED";
  if (isIdleExpired(session.ultimoUsoEn, now)) return "IDLE_EXPIRED";
  return null;
}
