/**
 * `activarCuenta(email, codigo, password, passwordRepeat)` (M02, FASE 2
 * point 2.3). Like `login`, NOT a `defineCommand` -- there is no session
 * yet (see modules/auth/application/login.ts's doc comment for the full
 * reasoning; the same applies here verbatim).
 *
 * Reuses `fsj.usuario_resolve_login` (migration 0010) to bootstrap
 * `{tenantId, usuarioId}` from the email -- see that migration's header
 * for why a SEPARATE resolver for `credencial_activacion` is not needed:
 * once `usuarioId` is known, `consumeCredencialActivacion` scopes its
 * atomic UPDATE to `(usuarioId, tokenHash)`, so a code that does not
 * belong to that usuario (wrong email, wrong code, or both) simply matches
 * zero rows -- no separate cross-check required.
 */
import { hashToken } from "../domain/token";
import { hashPassword } from "../domain/password";
import { validatePassword } from "@/shared/auth/policy";
import { resolveLoginByEmail, consumeCredencialActivacion, activarUsuario } from "../infrastructure/usuario-repository";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import { withTenantTransaction } from "@/shared/db/transaction";

/** Shown for every rejected activation: unknown email, wrong/unknown code, already used, revoked, or expired credential -- and for a password that fails policy (that one IS specific, since it carries no enumeration risk: the caller already knows their own email/code by the time policy is checked). */
export const GENERIC_ACTIVATION_ERROR = "El código no es válido, ya fue usado o venció. Pedí una credencial nueva al administrador.";

export type ActivarCuentaResult = { ok: true } | { ok: false; message: string };

export async function activarCuenta(email: string, codigo: string, password: string, passwordRepeat: string): Promise<ActivarCuentaResult> {
  if (password !== passwordRepeat) {
    return { ok: false, message: "Las contraseñas no coinciden." };
  }

  const policyErrors = validatePassword(password);
  if (policyErrors.length > 0) {
    return { ok: false, message: policyErrors.join(" ") };
  }

  const candidate = await resolveLoginByEmail(email);
  if (!candidate) {
    return { ok: false, message: GENERIC_ACTIVATION_ERROR };
  }

  const tokenHash = hashToken(codigo);
  const now = new Date();

  return withTenantTransaction(candidate.tenantId, async (tx) => {
    const consumed = await consumeCredencialActivacion(tx, candidate.usuarioId, tokenHash, now);
    if (consumed !== 1) {
      return { ok: false, message: GENERIC_ACTIVATION_ERROR };
    }

    const passwordHash = await hashPassword(password);
    await activarUsuario(tx, candidate.usuarioId, passwordHash);

    // No session exists -- the activating usuario is recorded as their
    // own audit author (task requirement: "audit ACTIVAR_CUENTA with the
    // activating user as the author").
    await auditRecord(tx, {
      tenantId: candidate.tenantId,
      usuarioId: candidate.usuarioId,
      entidad: "usuario",
      entidadId: candidate.usuarioId,
      accion: TipoAccion.ACTIVAR_CUENTA,
    });

    return { ok: true };
  });
}
