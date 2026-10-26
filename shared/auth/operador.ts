/**
 * Public "who is acting on a shared session" API (openspec/specs/cuentas-de-sector/spec.md).
 * Thin facade over `modules/auth` -- see `./session.ts` for why this
 * indirection exists (shared/usecase.ts must not import `modules/*`).
 * The request-scoped carrier of the credential is `./operador-context.ts`.
 */
export { verificarOperadorEnTx } from "@/modules/auth/application/verificar-operador";
export type { OperadorVerificado, VerificacionDeOperador } from "@/modules/auth/application/verificar-operador";
export type { MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";
