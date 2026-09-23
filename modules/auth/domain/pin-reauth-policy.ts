/**
 * Pure decision table for a PIN step-up attempt (user decision, 2026-09-23
 * PIN re-auth feature) -- same shape/spirit as `./login-policy.ts`'s
 * `decideLogin` and `modules/stock/domain/co-firma.ts`'s `decideCoFirma`.
 * No I/O: takes the already-resolved facts and returns WHY the attempt
 * would be rejected, used only to decide what to WRITE (increment the
 * counter? set pin_bloqueado? audit the block?) -- see
 * `modules/auth/application/reautenticar.ts`, which maps every non-"OK"
 * outcome to its own user-facing message (there is no shared enumeration
 * concern here the way login's generic message has, since this always
 * concerns the ALREADY-authenticated session's own usuario).
 */

export type PinReauthDecision = "NO_PIN" | "BLOCKED" | "WRONG_PIN" | "OK";

export interface PinReauthDecisionInput {
  /** `usuario.pin_hash` -- `null` means no PIN is configured at all. */
  pinHash: string | null;
  /** `usuario.pin_bloqueado`. */
  pinBloqueado: boolean;
  /** Result of `verifyPassword(pinHash, rawPin)` -- ALWAYS computed by the caller, even when `pinHash` is `null` or `pinBloqueado` is `true` (see `password.ts`'s dummy-hash fallback), so this decision table's branches don't leak timing. */
  pinMatches: boolean;
}

/**
 * Checked in this order: no PIN configured, then blocked (a blocked PIN is
 * rejected even if `pinMatches` happens to be true), then wrong PIN, then
 * OK.
 */
export function decidePinReauth(input: PinReauthDecisionInput): PinReauthDecision {
  if (!input.pinHash) return "NO_PIN";
  if (input.pinBloqueado) return "BLOCKED";
  if (!input.pinMatches) return "WRONG_PIN";
  return "OK";
}
