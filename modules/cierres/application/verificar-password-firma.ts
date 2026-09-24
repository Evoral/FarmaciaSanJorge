/**
 * `verificarPasswordFirma(password)` -- FASE 10, M13a point 10.1, user
 * decision 6 (2026-09-24): firming a cierre diario requires the DT's OWN
 * FULL PASSWORD (PIN is NEVER accepted here -- this command never reads
 * `pin_hash`, same structural guarantee `modules/auth/application/reautenticar.ts`'s
 * doc comment documents for its own PIN/password split).
 *
 * Deliberately its OWN `defineCommand` (not `requireRecentReauth`): the
 * password IS the proof for this specific action, at the strength this
 * legal signature needs -- `requireRecentReauth` would also accept a PIN
 * re-auth from up to `AUTH_POLICY.reauthWindowMinutes` ago, which the task
 * explicitly rules out for firming. Failures count toward the SAME
 * `intentos_fallidos`/`bloqueado_hasta` lockout `login()`/`reautenticar()`
 * use (own repository copy -- see `../infrastructure/cierre-repository.ts`'s
 * doc comment for why this module cannot import `modules/auth/infrastructure`),
 * and are audited only once they trip the lockout (`LOGIN_FALLIDO_BLOQUEO`),
 * exactly like `login.ts` -- not every failed attempt.
 *
 * `firmar-cierre.ts` is the ONLY caller: it runs this command FIRST, in its
 * own transaction, and only calls the internal firming command on success --
 * same "verify credentials in their own transaction, then call a
 * NON-exported internal command" shape as
 * `modules/libro/application/anular-asiento.ts`.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { record as auditRecord } from "@/shared/audit";
import { verifyPassword } from "@/modules/auth/domain/password";
import { decideLogin } from "@/modules/auth/domain/login-policy";
import { cargarUsuarioParaPasswordFirma, registrarFallaPasswordFirma, registrarExitoPasswordFirma } from "../infrastructure/cierre-repository";

const verificarPasswordFirmaInput = z.object({ password: z.string().min(1, "Ingresá tu contraseña.") });

export type VerificarPasswordFirmaInput = z.infer<typeof verificarPasswordFirmaInput>;

export type VerificarPasswordFirmaOutput = { ok: true } | { ok: false; message: string };

export const VERIFICAR_PASSWORD_FIRMA_GENERIC_ERROR = "La contraseña no es correcta, o la cuenta no puede firmar en este momento.";

export const verificarPasswordFirmaCommand = defineCommand<VerificarPasswordFirmaInput, VerificarPasswordFirmaOutput>({
  name: "cierres.jornada.verificarPasswordFirma",
  // The signer must already hold cierres.firmar (DIRECTOR_TECNICO only,
  // migration 0002) -- this command never verifies a DIFFERENT usuario's
  // password, only the SESSION's own.
  permiso: "cierres.firmar",
  input: verificarPasswordFirmaInput,
  audit: {
    skip: true,
    reason: "Audits CONDITIONALLY (only once the lockout trips, LOGIN_FALLIDO_BLOQUEO) via a manual auditRecord call -- see this file's module doc comment.",
  },
  handler: async ({ tx, session, input }) => {
    const usuario = await cargarUsuarioParaPasswordFirma(tx, session.usuario.id);
    if (!usuario) {
      // Unreachable in practice (the session's own usuario row always
      // exists), but never leaves the handler without a normal return --
      // see this file's doc comment on why every branch here returns
      // instead of throwing (a throw would roll back a failed attempt's
      // lockout write, same pitfall `reautenticar.ts` documents).
      throw new DomainError("No se pudo confirmar la contraseña.");
    }

    const passwordMatches = await verifyPassword(usuario.passwordHash, input.password);
    const now = new Date();
    const decision = decideLogin({ found: true, estado: usuario.estado, bloqueadoHasta: usuario.bloqueadoHasta, passwordMatches, now });

    if (decision === "OK") {
      await registrarExitoPasswordFirma(tx, session.usuario.id, now);
      const output: VerificarPasswordFirmaOutput = { ok: true };
      return { output };
    }

    if (decision === "WRONG_PASSWORD") {
      const intentosFallidos = usuario.intentosFallidos + 1;
      const lockedOut = intentosFallidos >= AUTH_POLICY.maxFailedLoginAttempts;
      const bloqueadoHasta = lockedOut ? new Date(now.getTime() + AUTH_POLICY.lockoutMinutes * 60 * 1000) : null;
      await registrarFallaPasswordFirma(tx, session.usuario.id, { intentosFallidos, bloqueadoHasta });

      if (lockedOut) {
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: "usuario",
          entidadId: session.usuario.id,
          accion: TipoAccion.LOGIN_FALLIDO_BLOQUEO,
          motivo: `Bloqueo tras ${intentosFallidos} intentos fallidos consecutivos (firma de cierre diario).`,
        });
      }
    }

    // LOCKED / INACTIVE / WRONG_PASSWORD collapse to the same generic
    // message -- this is the session's OWN account (no enumeration risk
    // the way `login()`/co-firma have), but there is still no reason to
    // let the UI distinguish "wrong password" from "temporarily locked".
    const output: VerificarPasswordFirmaOutput = { ok: false, message: VERIFICAR_PASSWORD_FIRMA_GENERIC_ERROR };
    return { output };
  },
});

export async function verificarPasswordFirma(input: VerificarPasswordFirmaInput, options?: ExecuteOptions): Promise<VerificarPasswordFirmaOutput> {
  return verificarPasswordFirmaCommand.execute(input, options);
}
