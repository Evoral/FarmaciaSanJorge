/**
 * The temporary-password pair shared by `crearUsuario` and
 * `restablecerCredencial` (docs/specs/contrasena-temporal.md): the
 * Administrador types it twice and it must satisfy the TEMPORARY password
 * policy (6 characters, no uppercase; the usuario's own password keeps the
 * full policy). The
 * refinement is applied by each command (`.superRefine(refinarPasswordTemporal)`)
 * so a mismatch is reported on the repeat field and policy errors on the
 * password field, exactly like the "Nueva contraseña" forms.
 */
import { z } from "zod";
import { validateTemporaryPassword } from "@/shared/auth/policy";

export const passwordTemporalFields = {
  passwordTemporal: z.string(),
  passwordTemporalRepeat: z.string(),
};

export function refinarPasswordTemporal(value: { passwordTemporal: string; passwordTemporalRepeat: string }, ctx: z.RefinementCtx): void {
  if (value.passwordTemporal !== value.passwordTemporalRepeat) {
    ctx.addIssue({ code: "custom", path: ["passwordTemporalRepeat"], message: "Las contraseñas no coinciden." });
  }
  for (const error of validateTemporaryPassword(value.passwordTemporal)) {
    ctx.addIssue({ code: "custom", path: ["passwordTemporal"], message: error });
  }
}
