/**
 * PIN re-auth feature (user decision, 2026-09-23): validation for the
 * "clave rápida" of `AUTH_POLICY.pinLength` digits (4 since 2026-10-13, it
 * was 6). Pure (no I/O) -- hashing/verification reuses
 * `hashPassword`/`verifyPassword` from `./password.ts` directly (same
 * argon2id setup as the real password, task requirement), so this file
 * only owns the format/triviality rules, mirroring how `validatePassword`
 * (shared/auth/policy.ts) owns the password's own rules.
 */
import { AUTH_POLICY } from "@/shared/auth/policy";

const PIN_PATTERN = new RegExp(`^\\d{${AUTH_POLICY.pinLength}}$`);

/** `true` iff `pin` is exactly `AUTH_POLICY.pinLength` numeric digits. */
export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** All digits identical (e.g. "1111", "0000"). */
function isAllSameDigit(digits: number[]): boolean {
  return digits.every((d) => d === digits[0]);
}

/** Strictly ascending (e.g. "1234") or strictly descending (e.g. "4321") consecutive digits. */
function isSequential(digits: number[]): boolean {
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

/**
 * `true` for a trivially guessable PIN: all digits equal, or a run of
 * consecutive ascending/descending digits. Callers MUST only call this on
 * a value that already passed `isValidPinFormat` -- it assumes only
 * numeric characters.
 */
export function isTrivialPin(pin: string): boolean {
  const digits = pin.split("").map(Number);
  return isAllSameDigit(digits) || isSequential(digits);
}

/**
 * Every violated rule (not just the first) -- same "show the whole list at
 * once" discipline as `validatePassword`. The one exception: an
 * incorrectly-formatted PIN skips the triviality check entirely (that
 * check assumes numeric digits and would otherwise report nonsense for,
 * say, a 3-letter input).
 */
export function validatePin(pin: string): string[] {
  const errors: string[] = [];
  if (!isValidPinFormat(pin)) {
    errors.push(`El PIN debe tener exactamente ${AUTH_POLICY.pinLength} dígitos numéricos.`);
    return errors;
  }
  if (isTrivialPin(pin)) {
    errors.push("El PIN no puede ser un valor trivial (todos los dígitos iguales o una secuencia consecutiva).");
  }
  return errors;
}
