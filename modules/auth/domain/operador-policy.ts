/**
 * Pure decision table: may this usuario act as the empleado ("operador") of
 * a cuenta de sector? (docs/specs/cuentas-de-sector.md) Same shape as
 * `./pin-reauth-policy.ts` / `modules/stock/domain/co-firma.ts`: it takes
 * the already-resolved facts and says why not, used only to decide what to
 * write and audit -- never returned to the caller as is.
 *
 * Proving the credential (`./verificacion-identidad.ts`) and holding the
 * permiso of the act (shared/usecase.ts) are separate checks.
 */

export type CandidatoOperadorDecision = "NO_ENCONTRADO" | "INACTIVO" | "NO_ES_EMPLEADO" | "DEBE_CAMBIAR_PASSWORD" | "OK";

export interface CandidatoOperadorInput {
  /** A usuario with that id exists in the session's tenant. */
  encontrado: boolean;
  /** `usuario.estado`, `null` when not found. */
  estado: string | null;
  /** A cuenta de sector identifies nobody: it can never be the operador. */
  esSector: boolean;
  /** The tenant's technical usuario (SISTEMA). */
  esTecnico: boolean;
  /**
   * The usuario still has a temporary password to replace
   * (docs/specs/contrasena-temporal.md): until they do, they cannot identify
   * themselves in a shared session, even with the right PIN.
   */
  debeCambiarPassword: boolean;
}

export function decideCandidatoOperador(input: CandidatoOperadorInput): CandidatoOperadorDecision {
  if (!input.encontrado) return "NO_ENCONTRADO";
  if (input.esSector || input.esTecnico) return "NO_ES_EMPLEADO";
  if (input.estado !== "ACTIVO") return "INACTIVO";
  if (input.debeCambiarPassword) return "DEBE_CAMBIAR_PASSWORD";
  return "OK";
}
