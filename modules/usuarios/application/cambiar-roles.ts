/**
 * `cambiarRoles` (M03, FASE 3 point 3.4). Takes the FULL desired role set
 * and diffs it against the usuario's current roles -- `roles` submitted
 * with zero entries is a zod validation error (INV-U02's "always >= 1
 * role" first line of defense; the DB's deferred constraint trigger is the
 * final one). Requires recent re-authentication (task's binding decision:
 * role changes are a sensitive admin action).
 *
 * Audits ONE row per added/removed role (`ASIGNAR_ROL`/`QUITAR_ROL`, plan
 * §9 M03 historia 4: "auditoría por cada rol") -- this is why `audit` is
 * declared `{ skip: true, ... }` on the command and `auditRecord` is
 * called directly, per-role, inside the handler instead: `defineCommand`'s
 * built-in `audit` option only writes ONE row per invocation, which cannot
 * express "N rows, one per changed role" on its own.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { ROLES_ASIGNABLES } from "../domain/roles";
import { esAccionSobreSiMismo, quedariaSinAdministradores } from "../domain/reglas-admin";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { loadUsuarioParaAccion, insertUsuarioRol, deleteUsuarioRol, tieneDesignacionDtVigente } from "../infrastructure/usuario-repository";

const cambiarRolesInput = z.object({
  usuarioId: uuid,
  roles: z.array(z.enum(ROLES_ASIGNABLES)).min(1, "El usuario debe conservar al menos un rol."),
});

export type CambiarRolesInput = z.infer<typeof cambiarRolesInput>;

export const cambiarRolesCommand = defineCommand({
  name: "usuarios.roles.modificar",
  permiso: "usuarios.roles.modificar",
  input: cambiarRolesInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { skip: true, reason: "Audits one ASIGNAR_ROL/QUITAR_ROL row per changed role via manual auditRecord calls below, not a single command-level entry." },
  handler: async ({ tx, session, input }) => {
    // Lock FIRST (same single ordered statement as the estado commands, so
    // no two admin commands can take these locks in different orders), THEN
    // read: the current roles and estado below come after the lock wait, so
    // two concurrent role changes on the same user cannot both diff against
    // a stale role set, and the last-admin check sees committed changes.
    const { idsAdminsActivos } = await lockUsuarioYAdministradoresActivos(tx, session.tenantId, input.usuarioId);

    const actual = await loadUsuarioParaAccion(tx, session.tenantId, input.usuarioId);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    const actuales = new Set<string>(actual.roles);
    const deseados = new Set<string>(input.roles);
    const aAgregar = input.roles.filter((codigo) => !actuales.has(codigo));
    const aQuitar = actual.roles.filter((codigo) => !deseados.has(codigo));

    if (aAgregar.length === 0 && aQuitar.length === 0) {
      throw new DomainError("No hay cambios de roles para aplicar.");
    }

    if (aQuitar.includes("ADMINISTRADOR")) {
      if (esAccionSobreSiMismo(session.usuario.id, input.usuarioId)) {
        throw new DomainError("No podés quitarte tu propio rol de Administrador.");
      }
      if (actual.estado === "ACTIVO") {
        if (quedariaSinAdministradores(idsAdminsActivos, input.usuarioId)) {
          throw new DomainError("Debe existir al menos un administrador activo; no se puede quitar este rol.");
        }
      }
    }

    if (aQuitar.includes("DIRECTOR_TECNICO")) {
      if (await tieneDesignacionDtVigente(tx, session.tenantId, input.usuarioId)) {
        throw new DomainError("Este usuario tiene una designación de Director Técnico vigente. Cesá la designación antes de quitar el rol.");
      }
    }

    for (const rolCodigo of aAgregar) {
      await insertUsuarioRol(tx, { tenantId: session.tenantId, usuarioId: input.usuarioId, rolCodigo, asignadoPorId: session.usuario.id });
      await auditRecord(tx, {
        tenantId: session.tenantId,
        usuarioId: session.usuario.id,
        entidad: "usuario",
        entidadId: input.usuarioId,
        accion: TipoAccion.ASIGNAR_ROL,
        valorNuevo: { rol: rolCodigo },
      });
    }

    for (const rolCodigo of aQuitar) {
      await deleteUsuarioRol(tx, session.tenantId, input.usuarioId, rolCodigo);
      await auditRecord(tx, {
        tenantId: session.tenantId,
        usuarioId: session.usuario.id,
        entidad: "usuario",
        entidadId: input.usuarioId,
        accion: TipoAccion.QUITAR_ROL,
        valorAnterior: { rol: rolCodigo },
      });
    }

    return { output: { roles: input.roles } };
  },
});

export async function cambiarRoles(input: CambiarRolesInput): Promise<{ roles: string[] }> {
  return cambiarRolesCommand.execute(input);
}
