/**
 * Which steps a usuario must complete before using the app
 * (docs/specs/contrasena-temporal.md). Pure -- no I/O.
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
}

/**
 * Returns `[]`, `["cambiar-password"]` or `["configurar-pin"]` -- never both:
 * the PIN is asked only after the password step, so the first element is the
 * current step.
 */
export function derivarPasosPendientes(f: FactoresDePasosPendientes): readonly PasoPendiente[] {
  if (f.debeCambiarPassword) return ["cambiar-password"];
  if (!f.tienePin && !f.esSector && !f.esTecnico) return ["configurar-pin"];
  return [];
}
