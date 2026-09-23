/**
 * `reactivarUsuario` (M03, FASE 3 point 3.5). Only SUSPENDIDO -> ACTIVO
 * (task requirement, narrower than the DB trigger which would also allow
 * PENDIENTE_ACTIVACION -> ACTIVO via the activation flow -- that path is
 * `activarCuenta`, not this admin command). BAJA is terminal: reactivating
 * from BAJA is never offered and is rejected with a clear message.
 *
 * M3 (security review): reactivar never removes an ADMINISTRADOR from the
 * ACTIVO set, so it has no last-admin check -- but it still locks the
 * target row FIRST via `lockUsuarioYAdministradoresActivos` (same
 * statement/order every other state-changing usuarios command uses, see
 * admin-guard.ts's LOCK ORDER doc comment) so `estadoAnterior` is read
 * from a locked, up-to-date snapshot, and so this command can never hold a
 * lock in an order that could deadlock against suspender/darDeBaja/
 * restablecerCredencial racing on an overlapping set of usuarios.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { loadUsuarioParaAccion, cambiarEstadoUsuario } from "../infrastructure/usuario-repository";

const reactivarUsuarioInput = z.object({
  usuarioId: uuid,
  motivo: nonEmptyString,
});

export type ReactivarUsuarioInput = z.infer<typeof reactivarUsuarioInput>;

export const reactivarUsuarioCommand = defineCommand({
  name: "usuarios.reactivar",
  permiso: "usuarios.reactivar",
  input: reactivarUsuarioInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "usuario", accion: "REACTIVAR" },
  handler: async ({ tx, session, input }) => {
    // M3: lock the target row first -- see admin-guard.ts's LOCK ORDER doc
    // comment. `idsAdminsActivos` is unused here (reactivar has no
    // last-admin check) but the lock itself is what matters.
    await lockUsuarioYAdministradoresActivos(tx, session.tenantId, input.usuarioId);

    const actual = await loadUsuarioParaAccion(tx, session.tenantId, input.usuarioId);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    if (actual.estado === "BAJA") {
      throw new DomainError("El usuario está dado de baja. La baja es definitiva y no admite reactivación.");
    }
    if (actual.estado !== "SUSPENDIDO") {
      throw new DomainError("Solo se puede reactivar un usuario SUSPENDIDO.");
    }

    const now = new Date();
    await cambiarEstadoUsuario(tx, {
      tenantId: session.tenantId,
      usuarioId: input.usuarioId,
      estadoAnterior: actual.estado,
      estadoNuevo: "ACTIVO",
      motivo: input.motivo,
      cambiadoPorId: session.usuario.id,
      now,
    });

    return {
      output: { id: input.usuarioId },
      audit: {
        entidadId: input.usuarioId,
        motivo: input.motivo,
        valorAnterior: { estado: actual.estado },
        valorNuevo: { estado: "ACTIVO" },
      },
    };
  },
});

export async function reactivarUsuario(input: ReactivarUsuarioInput): Promise<{ id: string }> {
  return reactivarUsuarioCommand.execute(input);
}
