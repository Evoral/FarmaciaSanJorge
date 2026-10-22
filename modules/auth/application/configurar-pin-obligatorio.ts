/**
 * `configurarPinObligatorio(pin, pinRepeat)` (docs/specs/contrasena-temporal.md,
 * step 2). A usuario with no PIN yet sets their first one right after the
 * password step, without being asked for the current password: that was just
 * set by them in step 1. Like `cambiarPasswordTemporal` it opts in to
 * `permitirPasosPendientes` because it is part of the flow that resolves the
 * pending steps. Changing an existing PIN stays in `configurarPin` («Mi
 * cuenta»), which does ask for the current password.
 *
 * Every precondition is read from the DB row inside the transaction, never
 * from the session snapshot, and checked before any write.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { validatePin } from "../domain/pin";
import { hashPassword } from "../domain/password";
import { loadUsuarioParaPassword, setPinHash } from "../infrastructure/usuario-repository";

const configurarPinObligatorioInput = z
  .object({
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

export const configurarPinObligatorioCommand = defineCommand({
  name: "auth.pin.configurarObligatorio",
  permiso: "auth.password.cambiar",
  permitirPasosPendientes: true,
  input: configurarPinObligatorioInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
    if (!usuario) {
      // Should be unreachable (the session's own usuario row always exists), but never trust it silently.
      throw new DomainError("No se pudo configurar el PIN.");
    }
    if (session.sector || usuario.esSector) {
      throw new DomainError("Las cuentas de sector no usan PIN.");
    }
    if (usuario.debeCambiarPassword) {
      throw new DomainError("Primero tenés que cambiar tu contraseña temporal.");
    }
    if (usuario.pinHash !== null) {
      throw new DomainError("Ya tenés un PIN configurado. Podés cambiarlo desde «Mi cuenta».");
    }

    // Same argon2id setup as the real password -- `hashPassword` is generic over the string it hashes.
    const pinHash = await hashPassword(input.pin);
    await setPinHash(tx, session.usuario.id, pinHash, new Date());

    return {
      output: {},
      audit: {
        entidadId: session.usuario.id,
        // Never log the PIN value or its hash (see shared/audit's module doc comment).
        motivo: "Configuración de PIN de reautenticación rápida por el propio usuario.",
      },
    };
  },
});

export async function configurarPinObligatorio(pin: string, pinRepeat: string): Promise<void> {
  await configurarPinObligatorioCommand.execute({ pin, pinRepeat });
}
