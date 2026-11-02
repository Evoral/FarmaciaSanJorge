/**
 * The equipo's modo del lector (openspec/specs/importacion-receta-qr/spec.md «Modo del equipo»): stored in this
 * browser's `localStorage`, one key per farmacia, so a browser shared by two farmacias does not mix them. A display
 * preference only: never sent to the server, never audited.
 *
 * Storage can be missing or throw (private mode, blocked site data, quota): every access is guarded and falls back to
 * "follow the farmacia" on read. A write that fails returns false so the caller keeps the choice for the open page.
 */
import { ELECCION_EQUIPO_SEGUN_FARMACIA, parseModoLectorQr, type EleccionEquipoLectorQr } from "../domain/modo-lector-qr";

export function clavePreferenciaLectorQr(tenantId: string): string {
  return `fsj.lector-qr.${tenantId}`;
}

/** The storage to use, or null when the browser has none or refuses access to it. */
export type AlmacenPreferencia = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function almacenDelNavegador(): AlmacenPreferencia | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored choice; anything unknown (or an unreadable storage) is "follow the farmacia". */
export function leerPreferenciaLectorQr(almacen: AlmacenPreferencia | null, tenantId: string): EleccionEquipoLectorQr {
  try {
    return parseModoLectorQr(almacen?.getItem(clavePreferenciaLectorQr(tenantId))) ?? ELECCION_EQUIPO_SEGUN_FARMACIA;
  } catch {
    return ELECCION_EQUIPO_SEGUN_FARMACIA;
  }
}

/** "Según la farmacia" removes the key. Returns whether the choice was saved. */
export function guardarPreferenciaLectorQr(almacen: AlmacenPreferencia | null, tenantId: string, eleccion: EleccionEquipoLectorQr): boolean {
  if (!almacen) return false;
  try {
    const clave = clavePreferenciaLectorQr(tenantId);
    if (eleccion === ELECCION_EQUIPO_SEGUN_FARMACIA) almacen.removeItem(clave);
    else almacen.setItem(clave, eleccion);
    return true;
  } catch {
    return false;
  }
}
