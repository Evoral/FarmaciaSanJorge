/**
 * The PIN implementation of `IdentificadorDeEmpleado`
 * (../domain/verificacion-identidad.ts): the PIN alone (`AUTH_POLICY.pinLength` digits) says which empleado is acting
 * from a cuenta de sector (openspec/specs/cuentas-de-sector/spec.md) -- no two usuarios of a farmacia share a PIN.
 *
 * The PIN is an identifier there, not a secret guarded by attempts (user decision 2026-10-28): no failed-attempt
 * counter, no block. `pin_intentos_fallidos` / `pin_bloqueado` only govern the PIN step-up of `./reautenticar.ts`.
 *
 * Every candidate's hash is checked (argon2, in parallel), with no early exit: a match on two is `AMBIGUA`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { verifyPassword } from "../domain/password";
import type { IdentificadorDeEmpleado } from "../domain/verificacion-identidad";
import { loadPinHashesDeOperadores } from "../infrastructure/usuario-repository";

export interface ContextoIdentificacion {
  tx: Prisma.TransactionClient;
  tenantId: string;
}

export const identificadorPin: IdentificadorDeEmpleado<"PIN", ContextoIdentificacion> = {
  metodo: "PIN",
  async identificar({ tx, tenantId }, prueba) {
    const candidatos = await loadPinHashesDeOperadores(tx, tenantId);
    const coincide = await Promise.all(candidatos.map((candidato) => verifyPassword(candidato.pinHash, prueba.pin)));
    const encontrados = candidatos.filter((_, indice) => coincide[indice]);
    if (encontrados.length === 1) return { ok: true, usuarioId: encontrados[0]!.id };
    return { ok: false, motivo: encontrados.length === 0 ? "NO_RECONOCIDA" : "AMBIGUA" };
  },
};
