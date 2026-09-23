/**
 * Assignable role codes (M03, plan §6/§9 M03). Deliberately EXCLUDES
 * `SISTEMA`: migration 0002's comment explains that `SISTEMA` has a real
 * `fsj.rol` row only to satisfy INV-U02 for the per-tenant technical user
 * (`usuario.es_tecnico = true`) -- it is "no asignable" at the application
 * layer, which is what this file enforces. Never add `SISTEMA` here.
 *
 * Hand-written (same convention as modules/auth/domain/permisos.ts) so a
 * typo is a compile error, and so `crearUsuario`/`cambiarRoles`'s zod
 * schemas can restrict `roles` to exactly this set -- SISTEMA is therefore
 * structurally impossible to submit from the admin UI or API, not just
 * hidden from it.
 */
export const ROLES_ASIGNABLES = [
  "ADMINISTRADOR",
  "DIRECTOR_TECNICO",
  "FARMACEUTICO",
  "ATENCION_PUBLICO",
  "SOLO_CONSULTA",
] as const;

export type RolAsignable = (typeof ROLES_ASIGNABLES)[number];

const ROLES_ASIGNABLES_SET: ReadonlySet<string> = new Set(ROLES_ASIGNABLES);

export function esRolAsignable(codigo: string): codigo is RolAsignable {
  return ROLES_ASIGNABLES_SET.has(codigo);
}

/** The one non-assignable, internal role code (migration 0002). Used to filter it out of any role/user listing that must never expose it. */
export const ROL_SISTEMA = "SISTEMA" as const;

/** Display labels (neutral, professional Spanish -- UI copy). */
export const ROL_LABELS: Record<RolAsignable, string> = {
  ADMINISTRADOR: "Administrador",
  DIRECTOR_TECNICO: "Director Técnico",
  FARMACEUTICO: "Farmacéutico",
  ATENCION_PUBLICO: "Atención al público",
  SOLO_CONSULTA: "Solo consulta",
};
