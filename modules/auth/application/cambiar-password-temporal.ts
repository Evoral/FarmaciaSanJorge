/**
 * `cambiarPasswordTemporal(nueva, nuevaRepeat)` (openspec/specs/contrasena-temporal/spec.md,
 * step 1). A usuario whose password was set by an administrator
 * (`debeCambiarPassword`) replaces it with their own. It does not ask for the
 * current password: the session was just opened with the temporary one. It
 * opts in to `permitirPasosPendientes` because this is the very flow that
 * resolves the pending step. The authoritative "is a change pending?" check
 * reads the DB row inside the transaction, never the session snapshot.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { validatePassword } from "@/shared/auth/policy";
import { verifyPassword, hashPassword } from "../domain/password";
import { loadUsuarioParaPassword, completarCambioPasswordTemporal } from "../infrastructure/usuario-repository";
import { revokeOtherSesionesForUsuario } from "../infrastructure/session-repository";

const cambiarPasswordTemporalInput = z
  .object({
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

export const cambiarPasswordTemporalCommand = defineCommand({
  name: "auth.password.cambiarTemporal",
  permiso: "auth.password.cambiar",
  permitirPasosPendientes: true,
  input: cambiarPasswordTemporalInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
    if (!usuario) {
      // Should be unreachable (the session's own usuario row always exists).
      throw new DomainError("No se pudo actualizar la contraseña.");
    }
    if (!usuario.debeCambiarPassword) {
      throw new DomainError("No tenés un cambio de contraseña pendiente. Si querés cambiarla, hacelo desde «Mi cuenta».");
    }
    if (usuario.passwordHash && (await verifyPassword(usuario.passwordHash, input.nueva))) {
      throw new DomainError("La nueva contraseña tiene que ser distinta de la temporal.", { fields: ["nueva"] });
    }

    const nuevoHash = await hashPassword(input.nueva);
    await completarCambioPasswordTemporal(tx, session.usuario.id, nuevoHash);

    const revocadas = await revokeOtherSesionesForUsuario(tx, session.tenantId, session.usuario.id, session.sesionId, new Date());

    return {
      // Never include a hash/password in output or audit -- see shared/audit.
      output: { sesionesRevocadas: revocadas },
      audit: {
        entidadId: session.usuario.id,
        motivo: "Cambio de contraseña temporal por el propio usuario.",
      },
    };
  },
});

export async function cambiarPasswordTemporal(nueva: string, nuevaRepeat: string): Promise<{ sesionesRevocadas: number }> {
  return cambiarPasswordTemporalCommand.execute({ nueva, nuevaRepeat });
}
