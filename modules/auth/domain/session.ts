/**
 * The shape `requireSession()` returns to callers (FASE 2, plan §8 use-case
 * pattern step 1). Pure type-only module -- no I/O.
 */
import type { Permiso } from "./permisos";

export interface AuthenticatedUsuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
}

/**
 * The authenticated principal for the current request: which usuario,
 * which tenant (for `withTenantTransaction`), which sesion row (for
 * revocation/step-up checks), and their EFFECTIVE permission set (the
 * union over every role assigned to them -- loaded once by
 * `validateSession`/`requireSession` and carried on this object, which is
 * what satisfies "cache permissions for that request only": a Server
 * Action/route handler calls `requireSession()` exactly once, and every
 * `authorize`/`can` check for the rest of that request reads this same
 * `permisos` set instead of re-querying the DB).
 */
export interface AuthenticatedSession {
  usuario: AuthenticatedUsuario;
  tenantId: string;
  sesionId: string;
  permisos: ReadonlySet<Permiso>;
  /** `sesion.reautenticada_en` (FASE 2 point 2.5, INV-X02) -- `null` until `reautenticar()` sets it. Consumed by `requireRecentReauth` (./step-up.ts). */
  reautenticadaEn: Date | null;
}
