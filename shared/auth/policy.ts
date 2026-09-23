/**
 * Centralized auth policy values (credential expiry, session timeouts,
 * lockout thresholds). Pure constants -- no I/O, no Prisma, safe to import
 * from anywhere (including a module's domain layer).
 *
 * DP-20 (session/password policy) is UNRESOLVED -- see plan §21. Everything
 * in this file except `activationCredentialTtlHours` (a resolved value: 72h,
 * plan §9 M00 "Parametros iniciales") is a CONSERVATIVE DEFAULT, chosen so
 * FASE 2 has something safe to build against. Change the values here (one
 * place) once DP-20 resolves -- do not hardcode any of these numbers
 * anywhere else.
 *
 * `vencimiento_credencial_horas` intentionally does NOT live in the
 * `parametro` table (FASE 1.1/1.4): there are no tenant rows to seed a
 * `parametro` value into at migration time, and DP-20's still-open values
 * would need the same treatment inconsistently. Keeping all of them here,
 * together, in TS, is the simpler single source of truth for now -- revisit
 * once a tenant-level override actually becomes a requirement.
 */

export const AUTH_POLICY = {
  /** M02: activation/reset credential validity window. Resolved value (plan §9 M00). */
  activationCredentialTtlHours: 72,

  /** DP-20 pending. Idle session timeout. */
  sessionIdleMinutes: 30,

  /** DP-20 pending. Absolute session lifetime regardless of activity. */
  sessionAbsoluteHours: 12,

  /** DP-20 pending. Failed login attempts before temporary lockout. */
  maxFailedLoginAttempts: 5,

  /** DP-20 pending. Lockout duration once maxFailedLoginAttempts is reached. */
  lockoutMinutes: 15,

  /** DP-20 pending. Minimum password length for INV-AU-001 (titular-set passwords). */
  minPasswordLength: 12,

  /** DP-20 pending / INV-X02 pending. How recent a re-authentication must be for step-up actions. */
  reauthWindowMinutes: 15,

  /** Resolved value (user decision, PIN re-auth feature): exact length of the "clave rápida" PIN. Never a range -- the format check rejects anything else. */
  pinLength: 6,

  /** Resolved value (user decision, PIN re-auth feature): consecutive failed PIN attempts before `pin_bloqueado` -- a counter separate from `maxFailedLoginAttempts` (password lockout), so PIN brute-forcing can never lock the account itself (DoS avoidance) and password brute-forcing never touches the PIN counter. */
  maxFailedPinAttempts: 5,
} as const;

export type AuthPolicy = typeof AUTH_POLICY;

/**
 * Hard technical ceiling on password INPUT length -- unrelated to DP-20
 * (the business-policy minimum below). Argon2's cost is only mildly
 * input-length sensitive, but there is no reason to ever hash more than
 * this; guards against a pathologically large request body being fed
 * straight into the hasher. Kept here (not modules/auth/domain/password.ts)
 * so `validatePassword` and the hasher agree on one number.
 */
export const MAX_PASSWORD_LENGTH = 256;

/**
 * Password policy validation (FASE 2 points 2.3/2.4: shared by activation
 * and change-password). Checks ONLY the values already resolved in
 * `AUTH_POLICY` above (`minPasswordLength`) plus the technical ceiling
 * `MAX_PASSWORD_LENGTH` -- DP-20 is unresolved for anything beyond length
 * (character-class rules, breach-list checks, etc.), so this deliberately
 * does NOT invent additional requirements the plan does not specify.
 *
 * Returns every violated rule (not just the first), so the caller can show
 * a single, complete "lo que falta" message instead of a frustrating
 * one-error-at-a-time loop.
 */
export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < AUTH_POLICY.minPasswordLength) {
    errors.push(`Debe tener al menos ${AUTH_POLICY.minPasswordLength} caracteres.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`No puede superar los ${MAX_PASSWORD_LENGTH} caracteres.`);
  }
  if (password.trim().length === 0) {
    errors.push("No puede estar vacía.");
  }
  return errors;
}
