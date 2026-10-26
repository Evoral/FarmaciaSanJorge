/**
 * Which steps a usuario must complete before using the app
 * (openspec/specs/contrasena-temporal/spec.md). Pure -- no I/O.
 */
import type { PasoPendiente } from "@/shared/auth/pasos";

export interface FactoresDePasosPendientes {
  /** `usuario.debe_cambiar_password`: the password was set by someone else (activation or reset). */
  debeCambiarPassword: boolean;
  tienePin: boolean;
  /** A cuenta de sector identifies its empleados per act, so it has no PIN of its own. */
  esSector: boolean;
  /** The SISTEMA technical user never logs in interactively. */
  esTecnico: boolean;
  /** ADMINISTRADOR "no ejerce actos operativos": a usuario whose roles are exactly the Administrador role has no PIN (`esSoloAdministrador`). */
  soloAdministrador: boolean;
}

/**
 * True when the usuario has at least one role and every role is the locked
 * ADMINISTRADOR (`rol.es_administrador`). Administrador plus any other role is
 * NOT admin-only: that usuario can perform operative acts, so it needs a PIN.
 */
export function esSoloAdministrador(roles: readonly { esAdministrador: boolean }[]): boolean {
  return roles.length > 0 && roles.every((rol) => rol.esAdministrador);
}

/**
 * Returns `[]`, `["cambiar-password"]` or `["configurar-pin"]` -- never both:
 * the PIN is asked only after the password step, so the first element is the
 * current step.
 */
export function derivarPasosPendientes(f: FactoresDePasosPendientes): readonly PasoPendiente[] {
  if (f.debeCambiarPassword) return ["cambiar-password"];
  if (!f.tienePin && !f.esSector && !f.esTecnico && !f.soloAdministrador) return ["configurar-pin"];
  return [];
}
