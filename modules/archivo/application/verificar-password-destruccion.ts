/**
 * `verificarPasswordDestruccion(password)` -- FASE 12 point 12.3, user
 * decision 5: every destrucción step (solicitar/autorizar/registrar)
 * requires the DT's OWN FULL PASSWORD (PIN is NEVER accepted -- this
 * command never reads `pin_hash`). Own copy of
 * `modules/cierres/application/verificar-password-firma.ts` -- see that
 * file's doc comment for the full rationale (own `defineCommand`, not
 * `requireRecentReauth`; failures share the login lockout counters and are
 * only audited once the lockout trips).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { record as auditRecord } from "@/shared/audit";
import { verifyPassword } from "@/modules/auth/domain/password";
import { decideLogin } from "@/modules/auth/domain/login-policy";
import { cargarUsuarioParaPasswordDestruccion, registrarFallaPasswordDestruccion, registrarExitoPasswordDestruccion } from "../infrastructure/archivo-repository";

const verificarPasswordDestruccionInput = z.object({ password: z.string().min(1, "Ingresá tu contraseña.") });

export type VerificarPasswordDestruccionInput = z.infer<typeof verificarPasswordDestruccionInput>;

export type VerificarPasswordDestruccionOutput = { ok: true } | { ok: false; message: string };

export const VERIFICAR_PASSWORD_DESTRUCCION_GENERIC_ERROR = "La contraseña no es correcta, o la cuenta no puede continuar el trámite en este momento.";

export const verificarPasswordDestruccionCommand = defineCommand<VerificarPasswordDestruccionInput, VerificarPasswordDestruccionOutput>({
  name: "archivo.destruccion.verificarPassword",
  // The caller must already hold archivo.destruccion.gestionar
  // (DIRECTOR_TECNICO only, migration 0002) -- this command never verifies
  // a DIFFERENT usuario's password, only the SESSION's own.
  permiso: "archivo.destruccion.gestionar",
  input: verificarPasswordDestruccionInput,
  audit: {
    skip: true,
    reason: "Audits CONDITIONALLY (only once the lockout trips, LOGIN_FALLIDO_BLOQUEO) via a manual auditRecord call -- see this file's module doc comment.",
  },
  handler: async ({ tx, session, input }) => {
    const usuario = await cargarUsuarioParaPasswordDestruccion(tx, session.usuario.id);
    if (!usuario) {
      throw new DomainError("No se pudo confirmar la contraseña.");
    }

    const passwordMatches = await verifyPassword(usuario.passwordHash, input.password);
    const now = new Date();
    const decision = decideLogin({ found: true, estado: usuario.estado, bloqueadoHasta: usuario.bloqueadoHasta, passwordMatches, now });

    if (decision === "OK") {
      await registrarExitoPasswordDestruccion(tx, session.usuario.id, now);
      const output: VerificarPasswordDestruccionOutput = { ok: true };
      return { output };
    }

    if (decision === "WRONG_PASSWORD") {
      const intentosFallidos = usuario.intentosFallidos + 1;
      const lockedOut = intentosFallidos >= AUTH_POLICY.maxFailedLoginAttempts;
      const bloqueadoHasta = lockedOut ? new Date(now.getTime() + AUTH_POLICY.lockoutMinutes * 60 * 1000) : null;
      await registrarFallaPasswordDestruccion(tx, session.usuario.id, { intentosFallidos, bloqueadoHasta });

      if (lockedOut) {
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: "usuario",
          entidadId: session.usuario.id,
          accion: TipoAccion.LOGIN_FALLIDO_BLOQUEO,
          motivo: `Bloqueo tras ${intentosFallidos} intentos fallidos consecutivos (trámite de destrucción de archivo).`,
        });
      }
    }

    const output: VerificarPasswordDestruccionOutput = { ok: false, message: VERIFICAR_PASSWORD_DESTRUCCION_GENERIC_ERROR };
    return { output };
  },
});

export async function verificarPasswordDestruccion(input: VerificarPasswordDestruccionInput, options?: ExecuteOptions): Promise<VerificarPasswordDestruccionOutput> {
  return verificarPasswordDestruccionCommand.execute(input, options);
}
