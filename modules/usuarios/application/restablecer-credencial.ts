/**
 * `restablecerCredencial` (M03, FASE 3 point 3.6, INV-U08), reworked by
 * docs/specs/contrasena-temporal.md: the Administrador types a NEW TEMPORARY
 * password (twice) for the usuario. It replaces the stored hash, sets
 * `debeCambiarPassword` (so the usuario must change it at the next login),
 * clears the failed-login lock and revokes every open session. The PIN is
 * deliberately left alone (CT5). The plaintext is hashed here and never
 * persisted, returned nor audited (CT1); the caller hands it over in person.
 *
 * Estado: PENDIENTE_ACTIVACION becomes ACTIVO (a temporary password is all it
 * was waiting for -- `cambiarEstadoUsuario` keeps the PIN when the new state is
 * ACTIVO); ACTIVO stays ACTIVO and SUSPENDIDO stays SUSPENDIDO (resetting a
 * password must not lift a suspension -- `reactivarUsuario` does that). Rejected
 * for a BAJA usuario (terminal) and for the plan §7 matrix condition "no sobre
 * sí mismo".
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
import { hashPassword } from "@/modules/auth/domain/password";
import { revokeAllSesionesForUsuarioInTx } from "@/modules/auth/application/revoke-session";
import { esAccionSobreSiMismo } from "../domain/reglas-admin";
import type { EstadoUsuario } from "../domain/estado-usuario";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { loadUsuarioParaAccion, cambiarEstadoUsuario, restablecerPasswordTemporal } from "../infrastructure/usuario-repository";
import { passwordTemporalFields, refinarPasswordTemporal } from "./password-temporal";

const restablecerCredencialInput = z.object({ usuarioId: uuid, ...passwordTemporalFields }).superRefine(refinarPasswordTemporal);

export type RestablecerCredencialInput = z.infer<typeof restablecerCredencialInput>;

export const restablecerCredencialCommand = defineCommand({
  name: "usuarios.credencial.restablecer",
  permiso: "usuarios.credencial.restablecer",
  input: restablecerCredencialInput,
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
    const passwordHash = await hashPassword(input.passwordTemporal);
    await restablecerPasswordTemporal(tx, input.usuarioId, passwordHash);

    let estadoResultante: EstadoUsuario = actual.estado;
    if (actual.estado === "PENDIENTE_ACTIVACION") {
      estadoResultante = "ACTIVO";
      await cambiarEstadoUsuario(tx, {
        tenantId: session.tenantId,
        usuarioId: input.usuarioId,
        estadoAnterior: actual.estado,
        estadoNuevo: estadoResultante,
        motivo: "Contraseña temporal asignada: el usuario pasa a Activo.",
        cambiadoPorId: session.usuario.id,
        now,
      });
    }

    await revokeAllSesionesForUsuarioInTx(tx, session.tenantId, input.usuarioId, now);

    return {
      output: { estado: estadoResultante },
      audit: {
        entidadId: input.usuarioId,
        valorAnterior: { estado: actual.estado },
        // Never the password nor its hash (CT1).
        valorNuevo: { estado: estadoResultante },
      },
    };
  },
});

export async function restablecerCredencial(input: RestablecerCredencialInput): Promise<void> {
  await restablecerCredencialCommand.execute(input);
}
