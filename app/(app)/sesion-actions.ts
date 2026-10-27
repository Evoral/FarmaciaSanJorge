"use server";

/**
 * Server Actions behind `./vigilante-inactividad.tsx` and `./error.tsx`: they let the client learn that the session is
 * gone and land on /login, instead of a page or action failing with a generic error.
 */
import { requireSession, clearSessionCookie } from "@/shared/auth/session";
import { AuthenticationError } from "@/shared/errors";
import { logout } from "@/modules/auth/application/logout";

/**
 * `false` only when there is no valid session. Validating also refreshes `ultimo_uso_en`, so the watcher calls this
 * while the user is active to keep the session alive. A pending step still counts as a session (the layout handles it).
 */
export async function verificarSesionAction(): Promise<boolean> {
  try {
    await requireSession({ permitirPasosPendientes: true });
    return true;
  } catch (error) {
    if (error instanceof AuthenticationError) return false;
    throw error;
  }
}

/** Closes the session after client-side inactivity. Best-effort: the session may already have expired on the server. */
export async function cerrarSesionPorInactividadAction(): Promise<void> {
  try {
    await logout();
  } catch {
    // Already invalid: nothing to revoke.
  }
  await clearSessionCookie();
}
