/**
 * Authorization (M03 §7 / §13): the single source of truth for "may this
 * session perform this action". Pure -- operates only on the already-loaded
 * `session.permisos` set (see session.ts), no I/O, no DB re-query.
 *
 * `authorize` is the one every Server Action/route handler MUST call
 * before doing anything else (enforced structurally by
 * `shared/usecase.ts#defineCommand`/`defineQuery`, which call it
 * unconditionally as step 2 of the pipeline -- see that file). `can` is
 * for UI-only "hide this button" decisions and must NEVER be treated as a
 * substitute for the server-side `authorize` call plan §18 DoD item 5).
 */
import { AuthorizationError } from "@/shared/errors";
import type { AuthenticatedSession } from "./session";
import type { Permiso } from "./permisos";

/** Non-throwing check, for hiding UI. Never a substitute for `authorize` on the server. */
export function can(session: AuthenticatedSession, permiso: Permiso): boolean {
  return session.permisos.has(permiso);
}

/** Throws `AuthorizationError` if `session` does not hold `permiso`. The safe client-facing message never includes the permission code (see `shared/errors#toSafeError`); the code is kept in the raw `.message` for server logs only. */
export function authorize(session: AuthenticatedSession, permiso: Permiso): void {
  if (!can(session, permiso)) {
    throw new AuthorizationError(`Session lacks required permission: ${permiso}`);
  }
}
