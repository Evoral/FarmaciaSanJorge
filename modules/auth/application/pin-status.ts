/**
 * `pinDisponible()` (PIN re-auth feature, user decision 2026-09-23). Query:
 * whether the CURRENT session's usuario has an active (configured AND not
 * blocked) PIN -- used only by `modules/auth/ui/reauth-prompt.tsx` to
 * decide whether to default to a PIN input instead of a password input.
 * Read-only, no sensitive data returned (never the hash, never the
 * counter) -- same `permiso: "auth.login"` reuse as `reautenticar`, see
 * that file's doc comment.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { loadPinEstado } from "../infrastructure/usuario-repository";

export const pinDisponibleQuery = defineQuery({
  name: "auth.pin.disponible",
  permiso: "auth.login",
  input: z.object({}),
  handler: async ({ tx, session }) => {
    const pinEstado = await loadPinEstado(tx, session.usuario.id);
    return pinEstado !== null && pinEstado.pinHash !== null && !pinEstado.pinBloqueado;
  },
});

export async function pinDisponible(): Promise<boolean> {
  return pinDisponibleQuery.execute({});
}
