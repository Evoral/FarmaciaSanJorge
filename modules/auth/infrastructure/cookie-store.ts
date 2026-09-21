/**
 * The only file in modules/auth allowed to touch Next.js's request/response
 * APIs (`next/headers`). Everything cookie-SHAPED (name, httpOnly/sameSite/
 * secure/path) is pure and lives in `domain/cookie-policy.ts`; this file
 * just wires that shape to `cookies()`.
 */
import { cookies } from "next/headers";
import { getEnv } from "@/shared/env";
import { SESSION_COOKIE_NAME, buildSessionCookieOptions } from "../domain/cookie-policy";

export { SESSION_COOKIE_NAME };

function currentSessionCookieOptions() {
  return buildSessionCookieOptions(getEnv().NODE_ENV);
}

/** Reads the raw session token from the incoming request's cookie, or `null` if absent. */
export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/** Sets the session cookie on the outgoing response. Must be called from a Server Function or Route Handler (Next.js restriction -- cookies cannot be set while rendering). */
export async function writeSessionCookie(rawToken: string, expiraEn: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    ...currentSessionCookieOptions(),
    expires: expiraEn,
  });
}

/** Removes the session cookie (logout). Must be called from a Server Function or Route Handler. */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
