/**
 * Filters the global help guide to the entries permitted for the active session (CA3).
 *
 * Rules:
 * - An entry passes only if the session holds EVERY permiso listed in `entrada.permisos` (CA3).
 * - Fail-closed: an entry with an empty `permisos` list is excluded because
 *   `[].every(...)` would evaluate to true and leak the entry to unauthorized roles.
 * - Preserves the original guide order.
 */
import type { Permiso } from "@/shared/auth/authorize";
import type { EntradaGuia, GuiaAyuda } from "./guia";

export function filtrarGuia(
  guia: GuiaAyuda,
  permisos: ReadonlySet<Permiso>
): EntradaGuia[] {
  return guia.filter((entrada) => {
    if (entrada.permisos.length === 0) {
      return false;
    }
    return entrada.permisos.every((permiso) => permisos.has(permiso));
  });
}
