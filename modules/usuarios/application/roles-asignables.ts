/**
 * Shared steps of the role / usuarios use cases (not use cases themselves):
 *
 *   - `otorgablesDelActor`: the actor's own role codes and their GRANTABLE
 *     permisos -- what they hold, plus every `operativo` permiso when they
 *     hold ADMINISTRADOR (grant authority exception, see
 *     modules/usuarios/domain/roles.ts#permisosOtorgables). Read from the
 *     DB inside the command's transaction, not from the session.
 *   - `resolverRolesAAsignar` (crearUsuario / cambiarRoles): resolves the
 *     role codes a usuarios form submitted against the SESSION's tenant
 *     roles (DP-03: roles are per-tenant data since migration 0054, so the
 *     codes cannot be a hardcoded zod enum any more), and applies the
 *     escalation rule for assignments -- nobody hands a usuario a role whose
 *     effective permisos fall outside their grantable set.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Permiso } from "@/modules/auth/domain/permisos";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, ValidationError } from "@/shared/errors";
import { esRolAsignable, permisosFueraDeAlcance, permisosOtorgables, ROL_ADMINISTRADOR } from "../domain/roles";
import { codigosDeRolesDelUsuario, findRolesPorCodigo, type RolAsignableRow } from "../infrastructure/rol-repository";

export interface OtorgablesDelActor {
  rolesDelActor: string[];
  otorgables: Set<Permiso>;
}

export async function otorgablesDelActor(tx: Prisma.TransactionClient, session: AuthenticatedSession): Promise<OtorgablesDelActor> {
  const rolesDelActor = await codigosDeRolesDelUsuario(tx, session.tenantId, session.usuario.id);
  return { rolesDelActor, otorgables: permisosOtorgables(session.permisos, rolesDelActor.includes(ROL_ADMINISTRADOR)) };
}

export async function resolverRolesAAsignar(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  codigos: readonly string[],
): Promise<RolAsignableRow[]> {
  if (codigos.length === 0) return [];
  const unicos = [...new Set(codigos)];
  const roles = await findRolesPorCodigo(tx, session.tenantId, unicos);

  if (roles.length !== unicos.length || roles.some((rol) => !esRolAsignable(rol))) {
    throw new ValidationError("Alguno de los roles elegidos no existe o no se puede asignar. Recargá la página y volvé a intentar.", {
      fields: ["roles"],
    });
  }

  const { otorgables } = await otorgablesDelActor(tx, session);
  for (const rol of roles) {
    if (permisosFueraDeAlcance(rol.permisos, otorgables).length > 0) {
      throw new DomainError(`No podés asignar el rol "${rol.nombre}": incluye permisos que vos no podés otorgar.`);
    }
  }
  return roles;
}
