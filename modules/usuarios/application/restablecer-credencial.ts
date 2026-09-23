/**
 * `restablecerCredencial` (M03, FASE 3 point 3.6, INV-U08). Moves the
 * usuario back to PENDIENTE_ACTIVACION (a no-op state assignment when it
 * is already PENDIENTE_ACTIVACION -- the DB trigger's
 * `NEW.estado = OLD.estado` short-circuit allows that), revokes every
 * existing session and every previously-issued, still-active credential,
 * and issues a fresh 72h credential -- shown to the caller EXACTLY ONCE
 * (same discipline as `crearUsuario`, see that file's doc comment).
 * Rejected for a BAJA usuario (terminal) and for the plan §7 matrix
 * condition "no sobre sí mismo".
 *
 * M3 (security review): this command has no last-admin check (resetting a
 * credential does not, by itself, remove the ADMINISTRADOR role), but it
 * still locks the target row FIRST via `lockUsuarioYAdministradoresActivos`
 * -- same statement/order as every other state-changing usuarios command
 * (see admin-guard.ts's LOCK ORDER doc comment) -- so `estadoAnterior` is
 * read from a locked, up-to-date snapshot instead of a stale one.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { generateOpaqueToken, hashToken } from "@/modules/auth/domain/token";
import { revokeAllSesionesForUsuarioInTx } from "@/modules/auth/application/revoke-session";
import { esAccionSobreSiMismo } from "../domain/reglas-admin";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { loadUsuarioParaAccion, cambiarEstadoUsuario, revokeCredencialesActivas, insertCredencialActivacion } from "../infrastructure/usuario-repository";

const restablecerCredencialInput = z.object({ usuarioId: uuid });

export type RestablecerCredencialInput = z.infer<typeof restablecerCredencialInput>;

export interface RestablecerCredencialResult {
  /** Shown ONCE -- the caller (UI) must never persist or re-request this value. */
  credencial: string;
  credencialVenceEn: Date;
}

export const restablecerCredencialCommand = defineCommand({
  name: "usuarios.credencial.restablecer",
  permiso: "usuarios.credencial.restablecer",
  input: restablecerCredencialInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "usuario", accion: "RESTABLECER_CREDENCIAL" },
  handler: async ({ tx, session, input }) => {
    if (esAccionSobreSiMismo(session.usuario.id, input.usuarioId)) {
      throw new DomainError("No podés restablecer tu propia credencial.");
    }

    // M3: lock the target row first -- see admin-guard.ts's LOCK ORDER doc
    // comment. `idsAdminsActivos` is unused here (no last-admin check).
    await lockUsuarioYAdministradoresActivos(tx, session.tenantId, input.usuarioId);

    const actual = await loadUsuarioParaAccion(tx, session.tenantId, input.usuarioId);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    if (actual.estado === "BAJA") {
      throw new DomainError("El usuario está dado de baja. La baja es definitiva y no admite restablecimiento de credencial.");
    }

    const now = new Date();

    await cambiarEstadoUsuario(tx, {
      tenantId: session.tenantId,
      usuarioId: input.usuarioId,
      estadoAnterior: actual.estado,
      estadoNuevo: "PENDIENTE_ACTIVACION",
      motivo: "Restablecimiento de credencial de activación.",
      cambiadoPorId: session.usuario.id,
      now,
    });

    await revokeAllSesionesForUsuarioInTx(tx, session.tenantId, input.usuarioId, now);
    await revokeCredencialesActivas(tx, session.tenantId, input.usuarioId, now);

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const venceEn = new Date(now.getTime() + AUTH_POLICY.activationCredentialTtlHours * 60 * 60 * 1000);

    await insertCredencialActivacion(tx, {
      tenantId: session.tenantId,
      usuarioId: input.usuarioId,
      tokenHash,
      emitidaPorId: session.usuario.id,
      venceEn,
      motivoEmision: "RESTABLECIMIENTO",
    });

    return {
      output: { credencial: rawToken, credencialVenceEn: venceEn },
      audit: {
        entidadId: input.usuarioId,
        valorAnterior: { estado: actual.estado },
        valorNuevo: { estado: "PENDIENTE_ACTIVACION" },
      },
    };
  },
});

export async function restablecerCredencial(usuarioId: string): Promise<RestablecerCredencialResult> {
  return restablecerCredencialCommand.execute({ usuarioId });
}
