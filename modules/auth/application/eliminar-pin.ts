/**
 * `eliminarPin(passwordActual)` (PIN re-auth feature, user decision
 * 2026-09-23). Removes the usuario's own PIN entirely. Requires the
 * CURRENT full password in the same form (task requirement) -- same shape
 * as `configurar-pin.ts`.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { verifyPassword } from "../domain/password";
import { loadUsuarioParaPassword, clearPin } from "../infrastructure/usuario-repository";

const eliminarPinInput = z.object({
  passwordActual: z.string().min(1, "Ingresá tu contraseña actual."),
});

export const eliminarPinCommand = defineCommand({
  name: "auth.pin.eliminar",
  permiso: "auth.password.cambiar",
  input: eliminarPinInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
    if (!usuario) {
      throw new DomainError("No se pudo eliminar el PIN.");
    }

    const actualMatches = await verifyPassword(usuario.passwordHash, input.passwordActual);
    if (!actualMatches) {
      throw new DomainError("La contraseña actual no es correcta.");
    }

    if (usuario.pinHash === null) {
      throw new DomainError("No tenés un PIN configurado.");
    }

    const now = new Date();
    await clearPin(tx, session.usuario.id, now);

    return {
      output: {},
      audit: {
        entidadId: session.usuario.id,
        motivo: "Eliminación de PIN de reautenticación rápida por el propio usuario.",
      },
    };
  },
});

export async function eliminarPin(passwordActual: string): Promise<void> {
  await eliminarPinCommand.execute({ passwordActual });
}
