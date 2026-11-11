/**
 * Public platform-session API (openspec/specs/plataforma/spec.md). Thin facade over modules/auth, like
 * `shared/auth/session.ts`, so `app/(plataforma)` and `modules/plataforma` import the guard from one place.
 */
export { requireSuperAdmin, superAdminActual, logoutPlataforma } from "@/modules/auth/application/require-superadmin";
export { writePlataformaCookie, clearPlataformaCookie, PLATAFORMA_COOKIE_NAME } from "@/modules/auth/infrastructure/cookie-store";
export { PLATAFORMA_PATH } from "@/modules/auth/domain/cookie-policy";
export type { SuperAdminSession } from "@/modules/auth/domain/session-plataforma";
