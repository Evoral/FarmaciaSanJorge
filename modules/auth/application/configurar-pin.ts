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
 *
 * Cuentas de sector and usuarios whose only role is Administrador have no
 * PIN (openspec/specs/contrasena-temporal/spec.md, CT6/CT9): «Mi cuenta» hides the
 * panel for them, and this command rejects them server-side as well.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { validatePin } from "../domain/pin";
import { hashPassword } from "../domain/password";
import { setPinHash } from "../infrastructure/usuario-repository";
import { assertEmpleadoGestionaSuCredencial } from "./empleado-gestiona-su-credencial";
import { assertPinDisponible } from "./pin-disponible";

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
    const usuario = await assertEmpleadoGestionaSuCredencial(tx, session, {
      noSePudo: "No se pudo configurar el PIN.",
      sector: "Las cuentas de sector no usan PIN.",
      administrador: "El Administrador no usa PIN.",
      passwordActual: input.passwordActual,
    });

    await assertPinDisponible(tx, session.tenantId, session.usuario.id, input.pin);

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
