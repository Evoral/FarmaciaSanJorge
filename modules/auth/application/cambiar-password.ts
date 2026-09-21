/**
 * `cambiarPassword(actual, nueva, nuevaRepeat)` (M02, FASE 2 point 2.4).
 * Always has a session (a logged-in usuario changing their own password),
 * so unlike `login`/`activarCuenta` this goes through the normal
 * `defineCommand` pipeline.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { AUTH_POLICY, validatePassword } from "@/shared/auth/policy";
import { verifyPassword, hashPassword } from "../domain/password";
import { loadUsuarioParaPassword, updatePasswordHash } from "../infrastructure/usuario-repository";
import { revokeOtherSesionesForUsuario } from "../infrastructure/session-repository";

const cambiarPasswordInput = z
  .object({
    actual: z.string().min(1, "Ingresá tu contraseña actual."),
    nueva: z.string().min(1, "Ingresá la nueva contraseña."),
    nuevaRepeat: z.string().min(1, "Repetí la nueva contraseña."),
  })
  .superRefine((value, ctx) => {
    if (value.nueva !== value.nuevaRepeat) {
      ctx.addIssue({ code: "custom", path: ["nuevaRepeat"], message: "Las contraseñas no coinciden." });
    }
    for (const error of validatePassword(value.nueva)) {
      ctx.addIssue({ code: "custom", path: ["nueva"], message: error });
    }
  });

export const cambiarPasswordCommand = defineCommand({
  name: "auth.password.cambiar",
  permiso: "auth.password.cambiar",
  input: cambiarPasswordInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
    if (!usuario) {
      // Should be unreachable (the session's own usuario row always
      // exists), but never trust it silently.
      throw new DomainError("No se pudo actualizar la contraseña.");
    }

    const actualMatches = await verifyPassword(usuario.passwordHash, input.actual);
    if (!actualMatches) {
      throw new DomainError("La contraseña actual no es correcta.");
    }

    const nuevoHash = await hashPassword(input.nueva);
    await updatePasswordHash(tx, session.usuario.id, nuevoHash);

    const now = new Date();
    const revocadas = await revokeOtherSesionesForUsuario(tx, session.tenantId, session.usuario.id, session.sesionId, now);

    return {
      // Never include a hash/token in output or in the audit
      // valorAnterior/valorNuevo -- see shared/audit's module doc comment.
      output: { sesionesRevocadas: revocadas },
      audit: {
        entidadId: session.usuario.id,
        motivo: "Cambio de contraseña por el propio usuario.",
      },
    };
  },
});

export async function cambiarPassword(actual: string, nueva: string, nuevaRepeat: string): Promise<{ sesionesRevocadas: number }> {
  return cambiarPasswordCommand.execute({ actual, nueva, nuevaRepeat });
}

// Re-export so callers can reference the resolved minimum length without
// re-importing shared/auth/policy directly (UI convenience only).
export const MIN_PASSWORD_LENGTH = AUTH_POLICY.minPasswordLength;
