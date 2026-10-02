/**
 * Shared zod fields + audit snapshot of the role write commands
 * (crear-rol.ts / editar-rol.ts / eliminar-rol.ts). Not a use case itself.
 */
import { z } from "zod";
import { nonEmptyString } from "@/shared/validation";
import type { Permiso } from "@/modules/auth/domain/permisos";
import { DESCRIPCION_ROL_MAX, NOMBRE_ROL_MAX, permisosDeRolSchema } from "../domain/roles";

export const datosDeRolInput = {
  nombre: nonEmptyString.pipe(z.string().max(NOMBRE_ROL_MAX, `Como máximo ${NOMBRE_ROL_MAX} caracteres.`)),
  descripcion: z
    .string()
    .trim()
    .max(DESCRIPCION_ROL_MAX, `Como máximo ${DESCRIPCION_ROL_MAX} caracteres.`)
    .optional()
    .transform((value) => (value ? value : null)),
  /** Catalog-validated (unknown / non-role permisos rejected); de-duplicated. */
  permisos: permisosDeRolSchema.transform((permisos) => [...new Set(permisos)]),
};

/** What every CREAR_ROL / EDITAR_ROL / ELIMINAR_ROL audit row stores: nombre, descripción and the SORTED permiso list. */
export function snapshotDeRol(rol: { codigo: string; nombre: string; descripcion: string | null; permisos: readonly Permiso[] }) {
  return { codigo: rol.codigo, nombre: rol.nombre, descripcion: rol.descripcion, permisos: [...rol.permisos].sort() };
}
