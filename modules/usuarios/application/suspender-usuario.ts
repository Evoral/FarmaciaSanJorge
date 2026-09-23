/**
 * `suspenderUsuario` (M03, FASE 3 point 3.5, INV-USR-004/005). Only
 * ACTIVO -> SUSPENDIDO. Requires a motivo, recent re-authentication
 * (sensitive action), and revokes every session AND every pending
 * activation credential for the usuario immediately (task's binding
 * decision) -- a suspended usuario must not be able to keep using an
 * already-open session, nor activate via a credential issued before the
 * suspension.
 *
 * M3 (security review): the target row is locked FIRST
 * (`lockUsuarioYAdministradoresActivos`, single ordered statement -- see
 * that function's doc comment in admin-guard.ts for why), and `actual`
 * (which supplies `estadoAnterior` for both `usuario_estado_historial` and
 * the `registro_auditoria` row) is read AFTER the lock, so it reflects the
 * true current state under concurrency instead of an earlier, unlocked
 * snapshot that a racing admin action could have already invalidated.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { revokeAllSesionesForUsuarioInTx } from "@/modules/auth/application/revoke-session";
import { esAccionSobreSiMismo, quedariaSinAdministradores } from "../domain/reglas-admin";
import { explicarTransicionInvalida } from "../domain/estado-usuario";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { loadUsuarioParaAccion, cambiarEstadoUsuario, revokeCredencialesActivas } from "../infrastructure/usuario-repository";

const suspenderUsuarioInput = z.object({
  usuarioId: uuid,
  motivo: nonEmptyString,
});

export type SuspenderUsuarioInput = z.infer<typeof suspenderUsuarioInput>;

export const suspenderUsuarioCommand = defineCommand({
  name: "usuarios.suspender",
  permiso: "usuarios.suspender",
  input: suspenderUsuarioInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "usuario", accion: "SUSPENDER" },
  handler: async ({ tx, session, input }) => {
    if (esAccionSobreSiMismo(session.usuario.id, input.usuarioId)) {
      throw new DomainError("No podés suspender tu propia cuenta.");
    }

    // M3: lock the target row (+ the last-admin guard set, same statement)
    // BEFORE reading it -- see admin-guard.ts's LOCK ORDER doc comment.
    const { idsAdminsActivos } = await lockUsuarioYAdministradoresActivos(tx, session.tenantId, input.usuarioId);

    const actual = await loadUsuarioParaAccion(tx, session.tenantId, input.usuarioId);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    const transicionInvalida = explicarTransicionInvalida(actual.estado, "SUSPENDIDO");
    if (transicionInvalida) {
      throw new DomainError(actual.estado === "ACTIVO" ? transicionInvalida : "Solo se puede suspender un usuario ACTIVO.");
    }

    if (actual.roles.includes("ADMINISTRADOR")) {
      if (quedariaSinAdministradores(idsAdminsActivos, input.usuarioId)) {
        throw new DomainError("Debe existir al menos un administrador activo; no se puede suspender a este usuario.");
      }
    }

    const now = new Date();
    await cambiarEstadoUsuario(tx, {
      tenantId: session.tenantId,
      usuarioId: input.usuarioId,
      estadoAnterior: actual.estado,
      estadoNuevo: "SUSPENDIDO",
      motivo: input.motivo,
      cambiadoPorId: session.usuario.id,
      now,
    });

    const sesionesRevocadas = await revokeAllSesionesForUsuarioInTx(tx, session.tenantId, input.usuarioId, now);
    const credencialesRevocadas = await revokeCredencialesActivas(tx, session.tenantId, input.usuarioId, now);

    return {
      output: { sesionesRevocadas, credencialesRevocadas },
      audit: {
        entidadId: input.usuarioId,
        motivo: input.motivo,
        valorAnterior: { estado: actual.estado },
        valorNuevo: { estado: "SUSPENDIDO" },
      },
    };
  },
});

export async function suspenderUsuario(input: SuspenderUsuarioInput): Promise<{ sesionesRevocadas: number; credencialesRevocadas: number }> {
  return suspenderUsuarioCommand.execute(input);
}
