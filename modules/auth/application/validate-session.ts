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
 *      (`checkSessionLifecycle`; a cuenta de sector has the longer idle timeout)
 *   4. usuario must be ACTIVO (rejects PENDIENTE_ACTIVACION, SUSPENDIDO, BAJA)
 *   5. tenant must not have `fecha_baja` set
 * Only after all five pass do we load the permission union and touch
 * (idle-refresh) the session.
 */
import { hashToken } from "../domain/token";
import { derivarPasosPendientes } from "../domain/pasos-pendientes";
import { checkSessionLifecycle } from "../domain/session-policy";
import type { AuthenticatedSession } from "../domain/session";
import {
  resolveSessionTenant,
  findSesionCompletaByTokenHash,
  loadPermisosConPin,
  touchSesion,
} from "../infrastructure/session-repository";
import { withTenantTransaction } from "@/shared/db/transaction";

const TOUCH_MIN_INTERVAL_MS = 60_000;

export async function validateSession(rawToken: string, now: Date = new Date()): Promise<AuthenticatedSession | null> {
  const tokenHash = hashToken(rawToken);

  const tenantId = await resolveSessionTenant(tokenHash);
  if (!tenantId) return null;

  return withTenantTransaction(tenantId, async (tx) => {
    const completa = await findSesionCompletaByTokenHash(tx, tokenHash);
    if (!completa) return null;
    const { sesion, usuario, tenantFechaBaja } = completa;

    if (checkSessionLifecycle(sesion, now, usuario.esSector) !== null) return null;
    if (usuario.estado !== "ACTIVO") return null;
    if (tenantFechaBaja !== null) return null;

    // Idle-refresh is a write on every request; skip it while the last one is recent. The shortest idle timeout is 30 min, so a 1 min granularity is invisible.
    if (now.getTime() - sesion.ultimoUsoEn.getTime() > TOUCH_MIN_INTERVAL_MS) {
      await touchSesion(tx, sesion.id, now);
    }

    return {
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, apellido: usuario.apellido },
      tenantId,
      sesionId: sesion.id,
      permisos: usuario.permisos,
      reautenticadaEn: sesion.reautenticadaEn,
      // A cuenta de sector (docs/specs/cuentas-de-sector.md) carries which acciones ask an empleado's PIN.
      sector: usuario.esSector ? { permisosConPin: await loadPermisosConPin(tx, tenantId) } : null,
      pasosPendientes: derivarPasosPendientes({
        debeCambiarPassword: usuario.debeCambiarPassword,
        tienePin: usuario.tienePin,
        esSector: usuario.esSector,
        esTecnico: usuario.esTecnico,
        soloAdministrador: usuario.soloAdministrador,
      }),
      soloAdministrador: usuario.soloAdministrador,
    };
  });
}
