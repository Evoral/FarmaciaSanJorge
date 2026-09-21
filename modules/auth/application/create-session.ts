/**
 * `createSession` (M02, FASE 2 point 2.1). Called by the (later, FASE 2.2)
 * login use case once a usuario has been authenticated by other means
 * (password check) -- `tenantId`/`usuarioId` here MUST already come from
 * that verified usuario record, never from request input.
 *
 * Does NOT write the session cookie itself -- that is a separate,
 * Next.js-specific step (`modules/auth/infrastructure/cookie-store.ts`)
 * the caller performs once it has `rawToken`/`expiraEn`, since a Server
 * Function may need to do other work (e.g. clear `intentos_fallidos`,
 * write `ACTIVAR_CUENTA`/login audit) in the same request before the
 * response is produced.
 */
import { generateOpaqueToken, hashToken } from "../domain/token";
import { computeAbsoluteExpiry } from "../domain/session-policy";
import { insertSesion } from "../infrastructure/session-repository";

export interface CreateSessionResult {
  rawToken: string;
  sesionId: string;
  creadaEn: Date;
  expiraEn: Date;
}

export async function createSession(
  usuarioId: string,
  tenantId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<CreateSessionResult> {
  const rawToken = generateOpaqueToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiraEn = computeAbsoluteExpiry(now);

  const sesion = await insertSesion({ tenantId, usuarioId, tokenHash, ip, userAgent, expiraEn });

  return { rawToken, sesionId: sesion.id, creadaEn: sesion.creadaEn, expiraEn: sesion.expiraEn };
}
