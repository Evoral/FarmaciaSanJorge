/**
 * Pure activation-credential eligibility check (M02, FASE 2 point 2.3,
 * INV-AU-002). Mirrors EXACTLY the WHERE clause
 * `consumeCredencialActivacion` (modules/auth/infrastructure/
 * usuario-repository.ts) uses for the real atomic `UPDATE ... WHERE
 * usada_en IS NULL AND revocada_en IS NULL AND vence_en > now()` -- kept
 * here as a pure, unit-testable statement of the same rule (no I/O),
 * separate from the DB round trip that actually enforces it. The DB
 * remains the source of truth for the atomic, concurrency-safe version
 * (two simultaneous activation attempts race on the real UPDATE, not on
 * this function) -- this exists so the STATE MACHINE ITSELF (used / not
 * used, revoked / not revoked, expired / not expired) has a test that
 * does not need a database.
 */
export interface CredencialActivacionEstado {
  usadaEn: Date | null;
  revocadaEn: Date | null;
  venceEn: Date;
}

/** `true` only when the credential has never been used, never been revoked, and has not yet expired at `now`. */
export function isCredencialActiva(credencial: CredencialActivacionEstado, now: Date): boolean {
  return credencial.usadaEn === null && credencial.revocadaEn === null && credencial.venceEn.getTime() > now.getTime();
}
