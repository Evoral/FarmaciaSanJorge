/**
 * `configurarPin(passwordActual, pin, pinRepeat)` (PIN re-auth feature,
 * user decision 2026-09-23). Sets OR changes the usuario's own PIN --
 * both are the same write (upsert the hash, reset the counter/block).
 * Requires the CURRENT full password in the same form (task requirement),
 * same shape as `cambiar-password.ts`: always has a session, goes through
 * the normal `defineCommand` pipeline, no `requireRecentReauth` (the
 * inline password check IS the proof of identity, exactly like
 * `cambiarPassword`).
 *
 * `permiso: "auth.password.cambiar"` is a deliberate reuse (same reasoning
 * as `reautenticar`'s reuse of `auth.login`): this is the closest existing
 * permission for "manage my own credential", granted to every role.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { validatePin } from "../domain/pin";
import { hashPassword, verifyPassword } from "../domain/password";
import { loadUsuarioParaPassword, setPinHash } from "../infrastructure/usuario-repository";

const configurarPinInput = z
  .object({
    passwordActual: z.string().min(1, "Ingresá tu contraseña actual."),
    pin: z.string().min(1, "Ingresá el nuevo PIN."),
    pinRepeat: z.string().min(1, "Repetí el nuevo PIN."),
  })
  .superRefine((value, ctx) => {
    if (value.pin !== value.pinRepeat) {
      ctx.addIssue({ code: "custom", path: ["pinRepeat"], message: "Los PIN no coinciden." });
    }
    for (const error of validatePin(value.pin)) {
      ctx.addIssue({ code: "custom", path: ["pin"], message: error });
    }
  });

export const configurarPinCommand = defineCommand({
  name: "auth.pin.configurar",
  permiso: "auth.password.cambiar",
  input: configurarPinInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
    if (!usuario) {
      // Should be unreachable (the session's own usuario row always exists), but never trust it silently.
      throw new DomainError("No se pudo configurar el PIN.");
    }

    const actualMatches = await verifyPassword(usuario.passwordHash, input.passwordActual);
    if (!actualMatches) {
      throw new DomainError("La contraseña actual no es correcta.");
    }

    // Same argon2id setup as the real password (task requirement) --
    // `hashPassword` is generic over the string it hashes.
    const pinHash = await hashPassword(input.pin);
    const now = new Date();
    await setPinHash(tx, session.usuario.id, pinHash, now);

    return {
      output: {},
      audit: {
        entidadId: session.usuario.id,
        // Never log the PIN value or its hash (see shared/audit's module doc comment).
        motivo: usuario.pinHash === null ? "Configuración de PIN de reautenticación rápida por el propio usuario." : "Cambio de PIN de reautenticación rápida por el propio usuario.",
      },
    };
  },
});

export async function configurarPin(passwordActual: string, pin: string, pinRepeat: string): Promise<void> {
  await configurarPinCommand.execute({ passwordActual, pin, pinRepeat });
}
