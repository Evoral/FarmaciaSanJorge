/**
 * The shape `requireSession()` returns to callers (FASE 2, plan §8 use-case
 * pattern step 1). Pure type-only module -- no I/O.
 */
import type { Permiso } from "./permisos";
import type { MetodoVerificacion } from "./verificacion-identidad";

export interface AuthenticatedUsuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
}

/** Set on the session of a cuenta de sector (`usuario.es_sector`, docs/specs/cuentas-de-sector.md): a shared session per work area. */
export interface SesionDeSector {
  /** The acciones this farmacia asks an empleado's PIN for (`fsj.accion_con_pin`), loaded with the session. */
  permisosConPin: ReadonlySet<Permiso>;
}

/** Where a verified empleado is acting from: the cuenta de sector whose session carried the request. */
export interface TerminalDeOrigen {
  usuarioId: string;
  /** The cuenta de sector's display name (e.g. "Laboratorio"). */
  nombre: string;
  sesionId: string;
  /** How the empleado proved who they are in this act. */
  verificacion: MetodoVerificacion;
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
  /** Present when the session belongs to a cuenta de sector; absent/`null` for an individual session. */
  sector?: SesionDeSector | null;
  /**
   * Present only on the session a command HANDLER receives when the act was
   * attributed to an empleado verified in that same request
   * (shared/usecase.ts): `usuario` and `permisos` are then the empleado's
   * (permisos = cuenta de sector ∩ empleado), and this says where from.
   */
  terminal?: TerminalDeOrigen | null;
}
