/**
 * `darDeBajaUsuario` (M03, FASE 3 point 3.5, INV-USR-004/005). Any of
 * PENDIENTE_ACTIVACION/ACTIVO/SUSPENDIDO -> BAJA, terminal (DP-02
 * unresolved -- no reactivation path exists anywhere in this codebase).
 * Requires motivo, recent re-authentication, and revokes every session and
 * pending credential immediately (task's binding decision), same as
 * suspend.
 *
 * M3 (security review): target row locked first, `actual`/`estadoAnterior`
 * read after -- see suspender-usuario.ts's doc comment / admin-guard.ts's
 * LOCK ORDER section for the full reasoning.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { revokeAllSesionesForUsuarioInTx } from "@/modules/auth/application/revoke-session";
import { esAccionSobreSiMismo, quedariaSinAdministradores } from "../domain/reglas-admin";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { loadUsuarioParaAccion, cambiarEstadoUsuario, revokeCredencialesActivas } from "../infrastructure/usuario-repository";

const darDeBajaUsuarioInput = z.object({
  usuarioId: uuid,
  motivo: nonEmptyString,
});

export type DarDeBajaUsuarioInput = z.infer<typeof darDeBajaUsuarioInput>;

export const darDeBajaUsuarioCommand = defineCommand({
  name: "usuarios.baja",
  permiso: "usuarios.baja",
  input: darDeBajaUsuarioInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "usuario", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    if (esAccionSobreSiMismo(session.usuario.id, input.usuarioId)) {
      throw new DomainError("No podés dar de baja tu propia cuenta.");
    }

    // M3: lock the target row (+ the last-admin guard set, same statement)
    // BEFORE reading it -- see admin-guard.ts's LOCK ORDER doc comment.
    const { idsAdminsActivos } = await lockUsuarioYAdministradoresActivos(tx, session.tenantId, input.usuarioId);

    const actual = await loadUsuarioParaAccion(tx, session.tenantId, input.usuarioId);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    if (actual.estado === "BAJA") {
      throw new DomainError("El usuario ya está dado de baja.");
    }

    if (actual.roles.includes("ADMINISTRADOR") && actual.estado === "ACTIVO") {
      if (quedariaSinAdministradores(idsAdminsActivos, input.usuarioId)) {
        throw new DomainError("Debe existir al menos un administrador activo; no se puede dar de baja a este usuario.");
      }
    }

    const now = new Date();
    await cambiarEstadoUsuario(tx, {
      tenantId: session.tenantId,
      usuarioId: input.usuarioId,
      estadoAnterior: actual.estado,
      estadoNuevo: "BAJA",
      motivo: input.motivo,
      cambiadoPorId: session.usuario.id,
      now,
      bajaColumns: { fechaBaja: now, motivoBaja: input.motivo },
    });

    const sesionesRevocadas = await revokeAllSesionesForUsuarioInTx(tx, session.tenantId, input.usuarioId, now);
    const credencialesRevocadas = await revokeCredencialesActivas(tx, session.tenantId, input.usuarioId, now);

    return {
      output: { sesionesRevocadas, credencialesRevocadas },
      audit: {
        entidadId: input.usuarioId,
        motivo: input.motivo,
        valorAnterior: { estado: actual.estado },
        valorNuevo: { estado: "BAJA" },
      },
    };
  },
});

export async function darDeBajaUsuario(input: DarDeBajaUsuarioInput): Promise<{ sesionesRevocadas: number; credencialesRevocadas: number }> {
  return darDeBajaUsuarioCommand.execute(input);
}
