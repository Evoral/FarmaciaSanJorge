/**
 * Step-up (re-authentication) policy -- M02, FASE 2 point 2.5, INV-X02.
 * Pure: takes `session.reautenticadaEn` (set by `reautenticar()`, see
 * modules/auth/application/reautenticar.ts) and a window in minutes, and
 * either returns normally or throws a distinguishable error. No I/O, no
 * `new Date()` default baked in at the call site that matters (callers
 * that need determinism -- tests -- pass `now` explicitly; production call
 * sites, including shared/usecase.ts, rely on the default).
 *
 * `confirmar preparación` (FASE 8) and `firmar cierre` (FASE 10) will be
 * the first real callers, via `defineCommand`'s `requireRecentReauth`
 * option (shared/usecase.ts) -- this file is the policy those wire up to,
 * landed now so FASE 2 point 2.5 has a working, testable contract before
 * any concrete command needs it.
 */
import { StepUpRequiredError } from "@/shared/errors";
import type { AuthenticatedSession } from "./session";

/** `true` once `now` is within `maxAgeMinutes` of `reautenticadaEn` (`null` is never recent). */
export function isReauthRecent(reautenticadaEn: Date | null, maxAgeMinutes: number, now: Date): boolean {
  if (reautenticadaEn === null) return false;
  return now.getTime() - reautenticadaEn.getTime() <= maxAgeMinutes * 60 * 1000;
}

/**
 * Throws `StepUpRequiredError` (distinguishable from `AuthenticationError`/
 * `AuthorizationError` -- see shared/errors) unless `session` has a
 * `reautenticadaEn` within `maxAgeMinutes` of `now`. The UI (see
 * modules/auth/ui/reauth-prompt.tsx) catches this specific error shape to
 * decide whether to show the re-authentication prompt, as opposed to any
 * other failure.
 */
export function requireRecentReauth(session: AuthenticatedSession, maxAgeMinutes: number, now: Date = new Date()): void {
  if (!isReauthRecent(session.reautenticadaEn, maxAgeMinutes, now)) {
    throw new StepUpRequiredError();
  }
}
