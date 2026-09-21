/**
 * `validateSession` (M02, FASE 2 point 2.1): the one place that turns a raw
 * cookie token into an `AuthenticatedSession`, or decides it can't.
 *
 * Order of checks (any failure -> `null`, no distinction surfaced to the
 * caller -- `requireSession()` turns `null` into a single generic
 * `AuthenticationError`, so a client can never learn WHY a session was
 * rejected, only that it was):
 *   1. resolve the tenant from the token hash (RLS bootstrap, see
 *      migration 0009 / session-repository.ts)
 *   2. re-read the session row through the normal tenant-scoped (RLS) path
 *   3. lifecycle check: revoked / absolute-expired / idle-expired
 *      (`checkSessionLifecycle`)
 *   4. usuario must be ACTIVO (rejects PENDIENTE_ACTIVACION, SUSPENDIDO, BAJA)
 *   5. tenant must not have `fecha_baja` set
 * Only after all five pass do we load the permission union and touch
 * (idle-refresh) the session.
 */
import { hashToken } from "../domain/token";
import { checkSessionLifecycle } from "../domain/session-policy";
import type { AuthenticatedSession } from "../domain/session";
import {
  resolveSessionTenant,
  findSesionByTokenHash,
  loadUsuarioConPermisos,
  loadTenantFechaBaja,
  touchSesion,
} from "../infrastructure/session-repository";
import { withTenantTransaction } from "@/shared/db/transaction";

export async function validateSession(rawToken: string, now: Date = new Date()): Promise<AuthenticatedSession | null> {
  const tokenHash = hashToken(rawToken);

  const tenantId = await resolveSessionTenant(tokenHash);
  if (!tenantId) return null;

  return withTenantTransaction(tenantId, async (tx) => {
    const sesion = await findSesionByTokenHash(tx, tokenHash);
    if (!sesion) return null;

    if (checkSessionLifecycle(sesion, now) !== null) return null;

    const usuario = await loadUsuarioConPermisos(tx, sesion.usuarioId);
    if (!usuario || usuario.estado !== "ACTIVO") return null;

    const fechaBaja = await loadTenantFechaBaja(tx, tenantId);
    if (fechaBaja === undefined || fechaBaja !== null) return null;

    await touchSesion(tx, sesion.id, now);

    return {
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, apellido: usuario.apellido },
      tenantId,
      sesionId: sesion.id,
      permisos: usuario.permisos,
      reautenticadaEn: sesion.reautenticadaEn,
    };
  });
}
