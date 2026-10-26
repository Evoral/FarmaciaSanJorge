/**
 * The temporary-password pair shared by `crearUsuario` and
 * `restablecerCredencial` (openspec/specs/contrasena-temporal/spec.md): the
 * Administrador types it twice and it must satisfy the TEMPORARY password
 * policy (6 characters, no uppercase; the usuario's own password keeps the
 * full policy). The
 * refinement is applied by each command (`.superRefine(refinarPasswordTemporal)`)
 * so a mismatch is reported on the repeat field and policy errors on the
 * password field, exactly like the "Nueva contraseña" forms.
 *
 * A cuenta de sector never changes its own password (openspec/specs/cuentas-de-sector/spec.md):
 * the one the Administrador sets is definitive, so it gets the full policy
 * (`erroresDePasswordAsignada(password, true)`).
 */
import { z } from "zod";
import { validatePassword, validateTemporaryPassword } from "@/shared/auth/policy";

export const passwordTemporalFields = {
  passwordTemporal: z.string(),
  passwordTemporalRepeat: z.string(),
};

export function erroresDePasswordAsignada(password: string, esSector: boolean): string[] {
  return esSector ? validatePassword(password) : validateTemporaryPassword(password);
}

export function refinarPasswordTemporal(value: { passwordTemporal: string; passwordTemporalRepeat: string }, ctx: z.RefinementCtx, esSector = false): void {
  if (value.passwordTemporal !== value.passwordTemporalRepeat) {
    ctx.addIssue({ code: "custom", path: ["passwordTemporalRepeat"], message: "Las contraseñas no coinciden." });
  }
  for (const error of erroresDePasswordAsignada(value.passwordTemporal, esSector)) {
    ctx.addIssue({ code: "custom", path: ["passwordTemporal"], message: error });
  }
}
