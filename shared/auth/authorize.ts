/**
 * Public authorization API (M03 §7/§13, FASE 2 point 2.6). Thin facade
 * over `modules/auth/domain/{authorize,permisos}` -- see `session.ts` for
 * why this indirection exists.
 */
export { authorize, can } from "@/modules/auth/domain/authorize";
export { PERMISO_CODES, isPermiso } from "@/modules/auth/domain/permisos";
export type { Permiso } from "@/modules/auth/domain/permisos";
