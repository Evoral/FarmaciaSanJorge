/**
 * `login(email, password)` (M02, FASE 2 point 2.2).
 *
 * NOT a `defineCommand` (shared/usecase.ts): every `defineCommand` opens
 * with `requireSession()`, which throws when there is no session cookie --
 * but login is the action that CREATES the first session, so there is
 * necessarily no session yet when it runs. This mirrors the existing FASE
 * 2.1 primitives (`createSession`, `validateSession`, `revokeSession`),
 * which are plain application functions for the same reason. `logout`,
 * `cambiarPassword` and `reautenticar` (this module's other files) DO
 * already have a session by the time they run, so they use
 * `defineCommand` normally.
 *
 * DELIBERATE DEVIATION FROM THE TASK'S "may reveal locked" ALLOWANCE: the
 * task allows revealing "account temporarily locked" IF AND ONLY IF that
 * can be guaranteed to show only after a CORRECT password. This function
 * always increments/reads `intentos_fallidos`/`bloqueado_hasta` and always
 * runs the argon2 verification in the SAME order regardless of outcome, so
 * distinguishing "locked" from "wrong password" in the response would
 * require the caller to branch on `passwordMatches` -- which reintroduces
 * exactly the timing/response-shape asymmetry the generic message exists
 * to prevent (a locked account's response would need to look different
 * only when the password is ALSO right, which is observable both by
 * response content and by which code path ran). Rather than risk getting
 * that subtly wrong, this returns the SAME generic message for
 * unknown-email / wrong-password / inactive / locked, uniformly. See
 * `modules/auth/domain/login-policy.ts` for the decision table this
 * collapses.
 */
import { generateOpaqueToken, hashToken } from "../domain/token";
import { computeAbsoluteExpiry } from "../domain/session-policy";
import { verifyPassword } from "../domain/password";
import { decideLogin } from "../domain/login-policy";
import { resolveLoginByEmail, recordLoginSuccess, recordLoginFailure } from "../infrastructure/usuario-repository";
import { insertSesionInTx } from "../infrastructure/session-repository";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import { withTenantTransaction } from "@/shared/db/transaction";
import { AUTH_POLICY } from "@/shared/auth/policy";

/** The single, generic message for EVERY rejected login attempt (see module doc comment) -- never branch UI copy on the internal `LoginDecision`. */
export const GENERIC_LOGIN_ERROR = "El email o la contraseña son incorrectos, o la cuenta no puede iniciar sesión en este momento.";

export type LoginResult =
  | { ok: true; rawToken: string; expiraEn: Date }
  | { ok: false; message: string };

/**
 * `email` MUST already be normalized (trimmed/lowercased) by the caller's
 * zod schema (see `shared/validation#email`) -- this function does not
 * re-normalize, to keep the exact string it hashes/compares explicit.
 */
export async function login(email: string, password: string, ip: string | null, userAgent: string | null): Promise<LoginResult> {
  const candidate = await resolveLoginByEmail(email);

  // ALWAYS run a real argon2 verification, even for an unknown email --
  // verifyPassword(null, ...) falls back to a dummy hash internally, so
  // this branch's timing is indistinguishable from the "found" branch's.
  const passwordMatches = await verifyPassword(candidate?.passwordHash ?? null, password);

  if (!candidate) {
    return { ok: false, message: GENERIC_LOGIN_ERROR };
  }

  const now = new Date();
  const decision = decideLogin({
    found: true,
    estado: candidate.estado,
    bloqueadoHasta: candidate.bloqueadoHasta,
    passwordMatches,
    now,
  });

  return withTenantTransaction(candidate.tenantId, async (tx) => {
    if (decision === "OK") {
      await recordLoginSuccess(tx, candidate.usuarioId, now);

      const rawToken = generateOpaqueToken();
      const tokenHash = hashToken(rawToken);
      const expiraEn = computeAbsoluteExpiry(now);
      await insertSesionInTx(tx, { tenantId: candidate.tenantId, usuarioId: candidate.usuarioId, tokenHash, ip, userAgent, expiraEn });

      return { ok: true, rawToken, expiraEn };
    }

    // Only a WRONG PASSWORD for an otherwise-live account counts toward
    // the lockout counter -- an already-locked or inactive account gains
    // nothing from further counting (it is rejected regardless), and
    // counting it would only extend/obscure the lockout window for no
    // security benefit.
    if (decision === "WRONG_PASSWORD") {
      const intentosFallidos = candidate.intentosFallidos + 1;
      const lockedOut = intentosFallidos >= AUTH_POLICY.maxFailedLoginAttempts;
      const bloqueadoHasta = lockedOut ? new Date(now.getTime() + AUTH_POLICY.lockoutMinutes * 60 * 1000) : null;

      await recordLoginFailure(tx, candidate.usuarioId, { intentosFallidos, bloqueadoHasta });

      if (lockedOut) {
        // No session exists to author this -- the affected usuario is
        // recorded as their own audit actor (same convention as
        // ACTIVAR_CUENTA: the subject of a public, pre-session action is
        // its own author, never a client-supplied id).
        await auditRecord(tx, {
          tenantId: candidate.tenantId,
          usuarioId: candidate.usuarioId,
          entidad: "usuario",
          entidadId: candidate.usuarioId,
          accion: TipoAccion.LOGIN_FALLIDO_BLOQUEO,
          motivo: `Bloqueo tras ${intentosFallidos} intentos fallidos consecutivos.`,
        });
      }
    }

    return { ok: false, message: GENERIC_LOGIN_ERROR };
  });
}
