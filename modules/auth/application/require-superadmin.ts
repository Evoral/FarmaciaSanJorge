/**
 * The platform guard (openspec/specs/plataforma/spec.md P6). Fails closed: a missing cookie, a dead
 * session, an INACTIVO superadmin or ANY error (database down included) means "not a superadmin".
 *
 * `superAdminActual()` never throws (for the `/plataforma` layout, which decides between redirect and notFound);
 * `requireSuperAdmin()` throws `AuthenticationError` (first gate of every platform use case). The session lifecycle
 * itself is checked only in SQL (`fsj.plataforma_validar_sesion`), one place. Memoized per request (React `cache`),
 * like `requireSession()`.
 *
 * This is the first gate, not the only one: every platform SQL function validates the token hash again.
 */
import { cache } from "react";
import { AuthenticationError } from "@/shared/errors";
import { withPlatformTransaction } from "@/shared/db/transaction";
import { getLogger } from "@/shared/logging/logger";
import { getRequestContext } from "@/shared/audit/request-context";
import { hashToken } from "../domain/token";
import type { SuperAdminSession } from "../domain/session-plataforma";
import { readPlataformaCookie, clearPlataformaCookie } from "../infrastructure/cookie-store";
import { validarSesionPlataforma, cerrarSesionPlataforma } from "../infrastructure/superadmin-repository";

export const superAdminActual = cache(async function superAdminActual(): Promise<SuperAdminSession | null> {
  try {
    const rawToken = await readPlataformaCookie();
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const identidad = await withPlatformTransaction((tx) => validarSesionPlataforma(tx, tokenHash));
    return identidad ? { ...identidad, tokenHash } : null;
  } catch (error) {
    getLogger().error({ err: error }, "plataforma: session validation failed, treated as no session");
    return null;
  }
});

export async function requireSuperAdmin(): Promise<SuperAdminSession> {
  const sesion = await superAdminActual();
  if (!sesion) {
    throw new AuthenticationError("Tu sesión de plataforma no es válida o expiró. Iniciá sesión nuevamente.");
  }
  return sesion;
}

/** Revokes the platform session (audits LOGOUT when it was live) and expires the cookie. Never fails for a dead session. */
export async function logoutPlataforma(): Promise<void> {
  const rawToken = await readPlataformaCookie();
  if (rawToken) {
    const { ip, requestId } = await getRequestContext();
    await withPlatformTransaction((tx) => cerrarSesionPlataforma(tx, hashToken(rawToken), { ip, userAgent: null, requestId }));
  }
  await clearPlataformaCookie();
}
