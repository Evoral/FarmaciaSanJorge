/**
 * Pure login decision table (M02, FASE 2 point 2.2). No I/O: takes the
 * already-resolved facts (candidate found? locked? estado? did the
 * password match?) and returns WHY the attempt would be rejected --
 * unit-testable without a database (tests/unit/auth-login-policy.test.ts).
 *
 * IMPORTANT: `LoginDecision` is an internal diagnostic value, used only to
 * decide what to WRITE (increment intentos_fallidos? set bloqueado_hasta?
 * audit LOGIN_FALLIDO_BLOQUEO?). It must NEVER be mapped to a different
 * user-facing message per reason -- `modules/auth/application/login.ts`
 * collapses every non-"OK" outcome to the exact same generic message, so
 * the caller cannot learn from the response whether the email exists, the
 * password was wrong, the account is inactive, or it is locked (FASE 2
 * point 2.2: "el mensaje debe ser idéntico"). See login.ts for the one
 * exception the task allows (revealing "locked" only after a correct
 * password) -- this codebase does NOT take that exception; see login.ts's
 * doc comment for why.
 */

export type LoginDecision = "UNKNOWN_EMAIL" | "LOCKED" | "INACTIVE" | "WRONG_PASSWORD" | "OK";

export interface LoginDecisionInput {
  /** Whether `fsj.usuario_resolve_login` returned a row for the given email. */
  found: boolean;
  /** `usuario.estado`, or `null` when `found` is `false`. */
  estado: string | null;
  /** `usuario.bloqueado_hasta`, or `null` when `found` is `false` or the account was never locked. */
  bloqueadoHasta: Date | null;
  /** Result of `verifyPassword(candidate.passwordHash, rawPassword)` -- ALWAYS computed by the caller, even for `found: false` (see modules/auth/domain/password.ts for why). */
  passwordMatches: boolean;
  now: Date;
}

/** `true` once `now` is strictly before `bloqueadoHasta` (a `null` `bloqueadoHasta` is never locked). */
export function isLocked(bloqueadoHasta: Date | null, now: Date): boolean {
  return bloqueadoHasta !== null && bloqueadoHasta.getTime() > now.getTime();
}

/**
 * The decision table, in the order each check applies. Lockout is checked
 * BEFORE password correctness so a locked account is rejected "even with
 * the right password" (plan §9 M02 historia 1) rather than only rejected
 * because the password also happened to be wrong.
 */
export function decideLogin(input: LoginDecisionInput): LoginDecision {
  if (!input.found) return "UNKNOWN_EMAIL";
  if (isLocked(input.bloqueadoHasta, input.now)) return "LOCKED";
  if (input.estado !== "ACTIVO") return "INACTIVE";
  if (!input.passwordMatches) return "WRONG_PASSWORD";
  return "OK";
}
