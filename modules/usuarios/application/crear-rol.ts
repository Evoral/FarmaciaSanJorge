/**
 * `crearRol` (DP-03 RESUELTA 2026-10-01): a new custom role for the
 * session's tenant. Its `codigo` is generated from the nombre
 * (modules/usuarios/domain/roles.ts#generarCodigoRol) and never changes;
 * `nombre` must be unique in the tenant (case-insensitive).
 *
 * Escalation rule: the actor can only include permisos of their grantable
 * set -- what they hold, plus every operativo permiso for an
 * ADMINISTRADOR (`otorgablesDelActor` / `resolverPermisosDeRol`); the session basics
 * (`PERMISOS_BASE_DE_ROL`) are always added. Sensitive admin action:
 * requires a recent re-authentication, like cambiarRoles. Audited as
 * CREAR_ROL with nombre, descripción and the sorted permiso list.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, ValidationError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { generarCodigoRol, resolverPermisosDeRol } from "../domain/roles";
import { existeNombreDeRol, insertRol, listCodigosDeRol, reemplazarPermisosDeRol } from "../infrastructure/rol-repository";
import { datosDeRolInput, snapshotDeRol } from "./rol-input";
import { otorgablesDelActor } from "./roles-asignables";

const crearRolInput = z.object(datosDeRolInput);

export type CrearRolInput = z.input<typeof crearRolInput>;

export const crearRolCommand = defineCommand({
  name: "roles.crear",
  permiso: "roles.gestionar",
  input: crearRolInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "rol", accion: TipoAccion.CREAR_ROL },
  handler: async ({ tx, session, input }) => {
    if (await existeNombreDeRol(tx, session.tenantId, input.nombre)) {
      throw new ValidationError("Ya existe un rol con ese nombre.", { fields: ["nombre"] });
    }

    const { otorgables } = await otorgablesDelActor(tx, session);
    const resolucion = resolverPermisosDeRol({ solicitados: input.permisos, actuales: [], otorgables });
    if (!resolucion.ok) {
      throw new DomainError(`No podés otorgar estos permisos: ${resolucion.noOtorgables.join(", ")}.`, { fields: ["permisos"] });
    }

    const codigo = generarCodigoRol(input.nombre, await listCodigosDeRol(tx, session.tenantId));
    const { id } = await insertRol(tx, { tenantId: session.tenantId, codigo, nombre: input.nombre, descripcion: input.descripcion });
    await reemplazarPermisosDeRol(tx, session.tenantId, id, resolucion.permisos);

    return {
      output: { rolId: id, codigo },
      audit: {
        entidadId: id,
        valorNuevo: snapshotDeRol({ codigo, nombre: input.nombre, descripcion: input.descripcion, permisos: resolucion.permisos }),
      },
    };
  },
});

export async function crearRol(input: CrearRolInput): Promise<{ rolId: string; codigo: string }> {
  return crearRolCommand.execute(input);
}
