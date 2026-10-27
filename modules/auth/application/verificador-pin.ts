/**
 * The PIN implementation of `VerificadorDeIdentidad`
 * (../domain/verificacion-identidad.ts): checks an empleado's own
 * PIN (`AUTH_POLICY.pinLength` digits) when they act from a cuenta de sector (openspec/specs/cuentas-de-sector/spec.md).
 *
 * Same credential, counter and block as the PIN step-up of `./reautenticar.ts`
 * (`usuario.pin_hash` / `pin_intentos_fallidos` / `pin_bloqueado`,
 * `AUTH_POLICY.maxFailedPinAttempts`), decided by the same pure table
 * (`decidePinReauth`). It ALWAYS runs a real argon2 verification -- also for
 * a `null` usuario, a missing PIN or a blocked one (`verifyPassword` falls
 * back to a dummy hash) -- so the timing never tells the cases apart.
 *
 * Runs inside the caller's transaction and never throws for a rejected PIN:
 * the failed-attempt counter it writes must be committed (see
 * `./verificar-operador.ts`).
 */
import type { Prisma } from "@/generated/prisma/client";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { verifyPassword } from "../domain/password";
import { decidePinReauth } from "../domain/pin-reauth-policy";
import type { VerificadorDeIdentidad } from "../domain/verificacion-identidad";
import { loadPinEstado, recordPinFailure, resetPinLockout } from "../infrastructure/usuario-repository";

export const verificadorPin: VerificadorDeIdentidad<"PIN", Prisma.TransactionClient> = {
  metodo: "PIN",
  async verificar(tx, usuarioId, prueba) {
    const pinEstado = usuarioId === null ? null : await loadPinEstado(tx, usuarioId);
    const pinMatches = await verifyPassword(pinEstado?.pinHash ?? null, prueba.pin);
    const decision = decidePinReauth({ pinHash: pinEstado?.pinHash ?? null, pinBloqueado: pinEstado?.pinBloqueado ?? false, pinMatches });

    if (usuarioId === null || pinEstado === null) return { ok: false, motivo: "INCORRECTA" };

    if (decision === "OK") {
      await resetPinLockout(tx, usuarioId);
      return { ok: true };
    }
    if (decision === "NO_PIN") return { ok: false, motivo: "SIN_CREDENCIAL" };
    if (decision === "BLOCKED") return { ok: false, motivo: "BLOQUEADA" };

    const pinIntentosFallidos = await recordPinFailure(tx, usuarioId, AUTH_POLICY.maxFailedPinAttempts);
    const pinBloqueado = pinIntentosFallidos >= AUTH_POLICY.maxFailedPinAttempts;
    return { ok: false, motivo: "INCORRECTA", bloqueoAlcanzado: pinBloqueado };
  },
};
