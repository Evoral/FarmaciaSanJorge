/**
 * "Acciones con PIN" (openspec/specs/cuentas-de-sector/spec.md): which acciones ask
 * for the PIN of the empleado performing them when the session is a cuenta
 * de sector. Configured per farmacia; the set of acciones that CAN be
 * switched is fixed (`PERMISOS_CON_PIN_CONFIGURABLES`,
 * modules/auth/domain/permisos.ts). Pure -- no I/O.
 */
import { PERMISOS_CON_PIN_CONFIGURABLES, type Permiso } from "@/modules/auth/domain/permisos";

/** One configurable acción as the configuration screen shows it. */
export interface AccionConPin {
  codigo: Permiso;
  /** `fsj.permiso.descripcion`: the same text the role editor shows. */
  descripcion: string;
  pidePin: boolean;
}

/** The submitted codes as the set to store: de-duplicated, in catalog order. Callers have already rejected non-configurable codes. */
export function ordenarAccionesConPin(codigos: readonly string[]): Permiso[] {
  const elegidos = new Set(codigos);
  return PERMISOS_CON_PIN_CONFIGURABLES.filter((codigo) => elegidos.has(codigo));
}

/** What changed between two sets, for the audit row and the "no changes" check. */
export function diferenciaAccionesConPin(antes: readonly Permiso[], despues: readonly Permiso[]): { activadas: Permiso[]; desactivadas: Permiso[] } {
  const previos = new Set(antes);
  const nuevos = new Set(despues);
  return { activadas: despues.filter((codigo) => !previos.has(codigo)), desactivadas: antes.filter((codigo) => !nuevos.has(codigo)) };
}
