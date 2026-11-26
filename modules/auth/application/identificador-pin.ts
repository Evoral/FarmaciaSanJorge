/**
 * The PIN's `FuenteDeCodigos` and `IdentificadorDeEmpleado` (../domain/verificacion-identidad.ts): the PIN alone
 * (`AUTH_POLICY.pinLength` digits) says which empleado is acting from a cuenta de sector
 * (openspec/specs/cuentas-de-sector/spec.md) -- no two usuarios of a farmacia share a PIN. The matching itself is the
 * shared code strategy (./identificacion-por-codigo.ts).
 *
 * The PIN is an identifier there, not a secret guarded by attempts (user decision 2026-10-28): no failed-attempt
 * counter, no block. `pin_intentos_fallidos` / `pin_bloqueado` only govern the PIN step-up of `./reautenticar.ts`.
 */
import type { IdentificadorDeEmpleado } from "../domain/verificacion-identidad";
import { loadPinHashesDeOperadores, loadPinHashesDeOtros } from "../infrastructure/usuario-repository";
import { identificadorPorCodigo, type ContextoIdentificacion, type FuenteDeCodigos } from "./identificacion-por-codigo";

export type { ContextoIdentificacion } from "./identificacion-por-codigo";

/** Arrow functions on purpose: the repository functions are read when called, not when this module loads. */
export const fuentePin: FuenteDeCodigos = {
  candidatos: async (tx, tenantId) => (await loadPinHashesDeOperadores(tx, tenantId)).map((candidato) => ({ usuarioId: candidato.id, hash: candidato.pinHash })),
  hashesDeOtros: (tx, tenantId, usuarioId) => loadPinHashesDeOtros(tx, tenantId, usuarioId),
};

export const identificadorPin: IdentificadorDeEmpleado<"PIN", ContextoIdentificacion> = identificadorPorCodigo("PIN", "pin", fuentePin);
