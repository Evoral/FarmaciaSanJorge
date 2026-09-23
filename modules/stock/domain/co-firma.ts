/**
 * Pure co-signature decision table (M07, FASE 5 point 5.3, DP-08b RESUELTA:
 * "co-firma en el mismo acto"). No I/O -- takes the already-resolved facts
 * (candidate found? locked? estado? password matched? DT vigente today?)
 * and returns WHY the co-signature would be rejected, exactly mirroring
 * `modules/auth/domain/login-policy.ts#decideLogin` (same shape, same
 * "collapse every non-OK outcome to ONE generic message" discipline --
 * see `modules/stock/application/verificar-co-firma-dt.ts`).
 *
 * IMPORTANT: `CoFirmaDecision` is an internal diagnostic value, used only to
 * decide what to WRITE (increment the DT's intentos_fallidos? audit which
 * reason?) and is NEVER shown to the operator -- the task is explicit that
 * "the generic error message must not reveal whether the DT exists, is
 * inactive or has no current designation". Every non-"OK" value collapses
 * to the SAME user-facing message in the application layer.
 */

export type CoFirmaDecision =
  | "DESCONOCIDO" // no usuario with that id in this tenant
  | "BLOQUEADO" // locked out from too many recent failed attempts
  | "INACTIVO" // usuario.estado !== 'ACTIVO'
  | "PASSWORD_INCORRECTA"
  | "NO_VIGENTE_DT" // password correct, but not a DT vigente today (INV-U05)
  | "OK";

export interface CoFirmaDecisionInput {
  /** Whether a usuario row with the given id was found IN THE SESSION'S TENANT. */
  found: boolean;
  /** `usuario.estado`, or `null` when `found` is `false`. */
  estado: string | null;
  /** `usuario.bloqueado_hasta`, or `null` when `found` is `false` or never locked. */
  bloqueadoHasta: Date | null;
  /** Result of `verifyPassword(candidate.passwordHash, rawPassword)` -- ALWAYS computed by the caller, even for `found: false` (constant-time discipline, mirrors login()). */
  passwordMatches: boolean;
  /** `fsj.es_dt_vigente(dtUsuarioId, jornadaActual)` -- only meaningful (and only computed by the caller) when `found` and `passwordMatches`, but accepted unconditionally here for a simple, total function. */
  esDtVigente: boolean;
  now: Date;
}

/** `true` once `now` is strictly before `bloqueadoHasta` (mirrors `modules/auth/domain/login-policy.ts#isLocked`). */
export function estaBloqueado(bloqueadoHasta: Date | null, now: Date): boolean {
  return bloqueadoHasta !== null && bloqueadoHasta.getTime() > now.getTime();
}

/**
 * The decision table, in the order each check applies. Lockout is checked
 * BEFORE password correctness (same order as login) so a locked DT is
 * rejected even with the right password. `NO_VIGENTE_DT` is checked LAST
 * (only once the password is confirmed correct) -- there is no way to learn
 * "this DT exists and its password is right, but it is not vigente" without
 * also learning "the password was right", so ordering it last does not leak
 * anything beyond what a correct password already would.
 */
export function decideCoFirma(input: CoFirmaDecisionInput): CoFirmaDecision {
  if (!input.found) return "DESCONOCIDO";
  if (estaBloqueado(input.bloqueadoHasta, input.now)) return "BLOQUEADO";
  if (input.estado !== "ACTIVO") return "INACTIVO";
  if (!input.passwordMatches) return "PASSWORD_INCORRECTA";
  if (!input.esDtVigente) return "NO_VIGENTE_DT";
  return "OK";
}
