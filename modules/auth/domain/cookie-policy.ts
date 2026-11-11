/**
 * Pure shape of the session cookie's options (M02, plan §8: "cookie
 * httpOnly; Secure; SameSite=Lax"). Split out from
 * `modules/auth/infrastructure/cookie-store.ts` (which actually calls
 * `next/headers`) so the `secure`-in-production rule is unit-testable
 * without a Next.js request context.
 */
export const SESSION_COOKIE_NAME = "fsj_session";

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
}

/** `secure` is true in production only -- `next dev`/tests run over plain HTTP, and `Secure` cookies are dropped by browsers on non-HTTPS origins. */
export function buildSessionCookieOptions(nodeEnv: string): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: nodeEnv === "production",
    path: "/",
  };
}

/**
 * Platform (superadmin) session cookie (openspec/specs/plataforma/spec.md P4). Scoped to `/plataforma`, so
 * the browser never sends the platform token to a pharmacy route, and kept apart from `fsj_session` so one browser
 * never holds both kinds (the login clears the other one).
 */
export const PLATAFORMA_COOKIE_NAME = "fsj_plataforma";
export const PLATAFORMA_PATH = "/plataforma";

export interface PlataformaCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: typeof PLATAFORMA_PATH;
}

export function buildPlataformaCookieOptions(nodeEnv: string): PlataformaCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: nodeEnv === "production", path: PLATAFORMA_PATH };
}
