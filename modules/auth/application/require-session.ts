/**
 * `requireSession()` (M02, FASE 2 point 2.1): step 1 of the use-case
 * pattern (`shared/usecase.ts`). Reads the session cookie, validates it,
 * and either returns the `AuthenticatedSession` or throws
 * `AuthenticationError` -- callers never see `null`, so every downstream
 * step can assume a session exists once this returns.
 *
 * Rejects (via `validateSession`, see that file for the full order):
 * missing cookie, unknown/expired/revoked session, a usuario that is not
 * `ACTIVO` (PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA), or a tenant with
 * `fecha_baja` set.
 *
 * NOT a substitute for `proxy.ts` and vice versa: `proxy.ts` is an
 * optimistic, DB-free redirect for UX; THIS is the actual authorization
 * boundary, called from every Server Action / route handler (through
 * `defineCommand`/`defineQuery`).
 */
import { cache } from "react";
import { AuthenticationError } from "@/shared/errors";
import type { AuthenticatedSession } from "../domain/session";
import { readSessionCookie } from "../infrastructure/cookie-store";
import { validateSession } from "./validate-session";

/**
 * Memoized per request (`React.cache`): layouts, the page and every use case it
 * calls share ONE session validation instead of repeating the ~10 DB round trips
 * each time (a rejection is memoized too). Caveat: a handler that revokes or re-authenticates the
 * session and then calls `requireSession()` again in the SAME request would read
 * the pre-mutation snapshot.
 */
export const requireSession = cache(async function requireSession(): Promise<AuthenticatedSession> {
  const rawToken = await readSessionCookie();
  if (!rawToken) {
    throw new AuthenticationError("No hay una sesión iniciada. Iniciá sesión para continuar.");
  }

  const session = await validateSession(rawToken);
  if (!session) {
    throw new AuthenticationError("Tu sesión expiró o ya no es válida. Iniciá sesión nuevamente.");
  }

  return session;
});
