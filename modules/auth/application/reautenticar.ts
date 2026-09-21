/**
 * `reautenticar(password)` (M02, FASE 2 point 2.5, INV-X02). Always has a
 * session (step-up re-verifies an ALREADY logged-in usuario's password),
 * so this goes through `defineCommand` like `logout`/`cambiarPassword`.
 *
 * `permiso: "auth.login"` is a deliberate reuse, not a new permission: the
 * seeded `fsj.permiso` catalog (migration 0002, which this task must not
 * touch) has no dedicated "step-up" code, and `auth.login` is the closest
 * existing permission that represents "the right to prove you know this
 * usuario's password" -- granted to every role (plan §7), exactly like
 * step-up needs to be. Revisit if a future migration adds a dedicated
 * `auth.reautenticar` permiso.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { verifyPassword } from "../domain/password";
import { loadUsuarioParaPassword } from "../infrastructure/usuario-repository";
import { marcarReautenticada } from "../infrastructure/session-repository";

export const reautenticarCommand = defineCommand({
  name: "auth.reautenticar",
  permiso: "auth.login",
  input: z.object({ password: z.string().min(1, "Ingresá tu contraseña.") }),
  // A precondition check for OTHER actions (INV-X02), not itself a
  // distinct M02-audited event -- the actions that require it (confirmar
  // preparación, firmar cierre, in later phases) audit their own outcome.
  audit: { skip: true, reason: "Step-up itself is a precondition for other commands, not a distinct M02 audit event; see requireRecentReauth callers." },
  handler: async ({ tx, session, input }) => {
    const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
    if (!usuario) {
      throw new DomainError("No se pudo confirmar la contraseña.");
    }

    const matches = await verifyPassword(usuario.passwordHash, input.password);
    if (!matches) {
      throw new DomainError("La contraseña no es correcta.");
    }

    const now = new Date();
    await marcarReautenticada(tx, session.sesionId, now);

    return { output: { reautenticadaEn: now } };
  },
});

export async function reautenticar(password: string): Promise<{ reautenticadaEn: Date }> {
  return reautenticarCommand.execute({ password });
}
