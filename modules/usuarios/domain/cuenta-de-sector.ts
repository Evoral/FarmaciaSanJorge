/**
 * A cuenta de sector (`usuario.es_sector`, openspec/specs/cuentas-de-sector/spec.md)
 * is a work area, not a person: it has no apellido and no DNI of its own.
 * `fsj.usuario` requires both (and `dni` is unique per farmacia), so they
 * are DERIVED from the one thing the administrator types -- the sector's
 * name -- instead of asking for made-up data. Pure -- no I/O.
 *
 *   "Laboratorio" -> nombre "Sector", apellido "Laboratorio", dni "SECTOR-LABORATORIO"
 *
 * It reads naturally wherever a usuario is shown ("Sector Laboratorio",
 * "Laboratorio, Sector"), and the derived `dni` makes two cuentas de sector
 * with the same name collide on the existing unique constraint.
 */
export const NOMBRE_DE_CUENTA_DE_SECTOR = "Sector";

const PREFIJO_DNI_DE_SECTOR = "SECTOR-";

export interface IdentidadDeCuentaDeSector {
  nombre: string;
  apellido: string;
  dni: string;
}

/** `null` when the name has no letter or digit to build the identifier from. */
export function identidadDeCuentaDeSector(nombreDelSector: string): IdentidadDeCuentaDeSector | null {
  const apellido = nombreDelSector.trim().replace(/\s+/g, " ");
  const clave = apellido
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (clave.length === 0) return null;
  return { nombre: NOMBRE_DE_CUENTA_DE_SECTOR, apellido, dni: `${PREFIJO_DNI_DE_SECTOR}${clave}` };
}
