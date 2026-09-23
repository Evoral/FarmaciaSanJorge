/**
 * `reautenticar({password} | {pin})` (M02, FASE 2 point 2.5, INV-X02; PIN
 * branch added by the PIN re-auth feature, user decision 2026-09-23).
 * Always has a session (step-up re-verifies an ALREADY logged-in usuario's
 * own credential), so this goes through `defineCommand` like
 * `logout`/`cambiarPassword`.
 *
 * `permiso: "auth.login"` is a deliberate reuse, not a new permission --
 * see this file's original doc comment history / `verificarCoFirmaDt`'s
 * own reuse of a step-up permiso for the same reasoning: the seeded
 * `fsj.permiso` catalog (migration 0002, which this task must not touch)
 * has no dedicated "step-up" code, and `auth.login` is the closest
 * existing permission that represents "the right to prove you know this
 * usuario's own credential" -- granted to every role.
 *
 * WHY THE HANDLER NEVER THROWS FOR A WRONG PIN (only for the "usuario row
 * vanished" unreachable case): `defineCommand`'s transaction commits on a
 * normal return and rolls back on a throw (see
 * modules/stock/application/verificar-co-firma-dt.ts's own doc comment for
 * the exact same pitfall/fix). The PIN branch's failed-attempt counter
 * (`recordPinFailure`) and the block it may set MUST survive even though
 * the caller sees a rejection -- so every expected rejection (wrong PIN,
 * blocked PIN, no PIN configured, wrong password) is a NORMAL return
 * value, never a throw. The public `reautenticar()` wrapper below is what
 * turns a `{ ok: false }` result back into a thrown `DomainError` for
 * every OTHER caller in this codebase, which still expects step-up to
 * throw on failure (same contract as before this feature).
 *
 * PIN NEVER VALID FOR LOGIN/ACTIVATION/PASSWORD-CHANGE/CREDENTIAL-RESET/DT
 * CO-FIRMA: this is structural, not a runtime check -- `login.ts`,
 * `activar-cuenta.ts`, `cambiar-password.ts`, `restablecer-credencial.ts`
 * and both `verificar-co-firma-dt.ts` files never read `pin_hash` at all;
 * this command is the ONLY place `pin_hash` is ever compared against user
 * input.
 *
 * D (user decision, PIN re-auth feature): a successful PASSWORD re-auth
 * resets the PIN failed-attempt counter AND unblocks it (`resetPinLockout`)
 * -- "keep it simple", per the task. A successful PIN re-auth also resets
 * its own counter (ordinary good practice, mirrors `recordLoginSuccess`),
 * though it can never itself need to CLEAR a block (`decidePinReauth`
 * rejects a blocked PIN before it can ever reach "OK").
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import { verifyPassword } from "../domain/password";
import { decidePinReauth } from "../domain/pin-reauth-policy";
import { loadUsuarioParaPassword, loadPinEstado, resetPinLockout, recordPinFailure } from "../infrastructure/usuario-repository";
import { marcarReautenticada } from "../infrastructure/session-repository";

const reautenticarInput = z.union([
  z.object({ password: z.string().min(1, "Ingresá tu contraseña.") }),
  z.object({ pin: z.string().min(1, "Ingresá tu PIN.") }),
]);

export type ReautenticarInput = z.infer<typeof reautenticarInput>;

type ReautenticarOutput = { ok: true; reautenticadaEn: Date } | { ok: false; message: string };

export const reautenticarCommand = defineCommand<ReautenticarInput, ReautenticarOutput>({
  name: "auth.reautenticar",
  permiso: "auth.login",
  input: reautenticarInput,
  // A precondition check for OTHER actions (INV-X02), not itself a
  // distinct M02-audited event -- the actions that require it (confirmar
  // preparación, firmar cierre, etc.) audit their own outcome. The ONE
  // exception is a PIN reaching pin_bloqueado, which IS audited manually
  // below (task requirement) -- individual wrong-PIN/wrong-password
  // attempts are NOT audited, same as this command has always behaved for
  // password re-auth failures.
  audit: {
    skip: true,
    reason: "Step-up itself is a precondition for other commands, not a distinct M02 audit event; a PIN reaching pin_bloqueado is audited manually inside the handler instead.",
  },
  handler: async ({ tx, session, input }) => {
    const now = new Date();

    if ("password" in input) {
      const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
      if (!usuario) {
        throw new DomainError("No se pudo confirmar la contraseña.");
      }

      const matches = await verifyPassword(usuario.passwordHash, input.password);
      if (!matches) {
        const output: ReautenticarOutput = { ok: false, message: "La contraseña no es correcta." };
        return { output };
      }

      await marcarReautenticada(tx, session.sesionId, now);
      // D: a successful password re-auth resets AND unblocks the PIN (see module doc comment).
      await resetPinLockout(tx, session.usuario.id);

      const output: ReautenticarOutput = { ok: true, reautenticadaEn: now };
      return { output };
    }

    // PIN branch.
    const pinEstado = await loadPinEstado(tx, session.usuario.id);
    if (!pinEstado) {
      throw new DomainError("No se pudo confirmar el PIN.");
    }

    // ALWAYS run a real argon2 verification, even when there is no PIN
    // configured or the PIN is blocked -- verifyPassword(null, ...) falls
    // back to a dummy hash internally (see ../domain/password.ts), keeping
    // every branch's timing indistinguishable, same discipline as login().
    const pinMatches = await verifyPassword(pinEstado.pinHash, input.pin);
    const decision = decidePinReauth({ pinHash: pinEstado.pinHash, pinBloqueado: pinEstado.pinBloqueado, pinMatches });

    if (decision === "OK") {
      await marcarReautenticada(tx, session.sesionId, now);
      await resetPinLockout(tx, session.usuario.id);
      const output: ReautenticarOutput = { ok: true, reautenticadaEn: now };
      return { output };
    }

    if (decision === "WRONG_PIN") {
      const pinIntentosFallidos = pinEstado.pinIntentosFallidos + 1;
      const pinBloqueado = pinIntentosFallidos >= AUTH_POLICY.maxFailedPinAttempts;
      await recordPinFailure(tx, session.usuario.id, { pinIntentosFallidos, pinBloqueado });

      if (pinBloqueado) {
        // INV-A01: the ONE PIN-related event this command audits (task
        // requirement) -- authored by the session's own usuario (there is
        // no "other" actor here, unlike co-firma's operator/DT split).
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: "usuario",
          entidadId: session.usuario.id,
          accion: TipoAccion.MODIFICAR,
          motivo: `PIN bloqueado tras ${pinIntentosFallidos} intentos fallidos consecutivos.`,
        });
      }

      const output: ReautenticarOutput = { ok: false, message: "El PIN no es correcto." };
      return { output };
    }

    if (decision === "BLOCKED") {
      const output: ReautenticarOutput = { ok: false, message: "El PIN está bloqueado. Reautenticate con tu contraseña." };
      return { output };
    }

    // NO_PIN
    const output: ReautenticarOutput = { ok: false, message: "No tenés un PIN configurado. Usá tu contraseña." };
    return { output };
  },
});

export async function reautenticar(input: ReautenticarInput): Promise<{ reautenticadaEn: Date }> {
  const result = await reautenticarCommand.execute(input);
  if (!result.ok) {
    throw new DomainError(result.message);
  }
  return { reautenticadaEn: result.reautenticadaEn };
}
