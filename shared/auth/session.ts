/**
 * Public session API (M02, FASE 2 point 2.1). Thin facade: the real
 * implementation lives in `modules/auth/{domain,application,infrastructure}`
 * (M02 is a business module like any other); this file just re-exports the
 * stable entry points so the rest of the app (and `shared/usecase.ts`,
 * which cannot import from `modules/*` without inverting the dependency
 * direction shared/ -> modules/ that the rest of the codebase relies on)
 * has one place to import "sessions" from, matching the promise already
 * made in docs/architecture.md's directory table.
 */
export { requireSession } from "@/modules/auth/application/require-session";
export { createSession } from "@/modules/auth/application/create-session";
export { validateSession } from "@/modules/auth/application/validate-session";
export { touchSession } from "@/modules/auth/application/touch-session";
export { revokeSession, revokeAllSessionsForUser } from "@/modules/auth/application/revoke-session";
export { readSessionCookie, writeSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from "@/modules/auth/infrastructure/cookie-store";
/** FASE 2 point 2.5 / INV-X02. Re-exported here (not imported directly from modules/auth/domain) so shared/usecase.ts can use it without inverting the shared/ -> modules/ dependency direction -- see this file's module doc comment. */
export { requireRecentReauth } from "@/modules/auth/domain/step-up";

export type { AuthenticatedSession, AuthenticatedUsuario } from "@/modules/auth/domain/session";
export type { CreateSessionResult } from "@/modules/auth/application/create-session";
