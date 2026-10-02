"use server";

/**
 * Server Actions for `/admin/accesos/roles/**` (DP-03). Every write goes
 * through its `roles.gestionar` command (authorize -> step-up -> zod ->
 * tx -> audit); the raw FormData is only re-shaped here, never trusted:
 * `permisos` is validated against the catalog by the command's zod schema.
 * Disabled checkboxes (permisos the actor lacks, session basics) are never
 * submitted -- the command keeps/adds those itself (see
 * modules/usuarios/domain/roles.ts#resolverPermisosDeRol).
 */
import { crearRol } from "@/modules/usuarios/application/crear-rol";
import { editarRol } from "@/modules/usuarios/application/editar-rol";
import { eliminarRol } from "@/modules/usuarios/application/eliminar-rol";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import type { Permiso } from "@/modules/auth/domain/permisos";

export type RolActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "reauth-required" }
  | { status: "success"; message?: string; rolId?: string };

function fromError(error: unknown, fallback: string): RolActionState {
  if (error instanceof StepUpRequiredError) {
    return { status: "reauth-required" };
  }
  return actionError(error, fallback);
}

function datosDelForm(formData: FormData) {
  return {
    nombre: String(formData.get("nombre") ?? ""),
    descripcion: String(formData.get("descripcion") ?? ""),
    // The cast only satisfies TypeScript at this untyped FormData boundary --
    // the command's zod schema (permisosDeRolSchema) is the real, catalog-backed validation.
    permisos: formData.getAll("permisos").map(String) as Permiso[],
  };
}

export async function crearRolAction(_prevState: RolActionState, formData: FormData): Promise<RolActionState> {
  try {
    const result = await crearRol(datosDelForm(formData));
    return { status: "success", message: "Rol creado.", rolId: result.rolId };
  } catch (error) {
    return fromError(error, "No se pudo crear el rol.");
  }
}

export async function editarRolAction(_prevState: RolActionState, formData: FormData): Promise<RolActionState> {
  try {
    const result = await editarRol({ rolId: String(formData.get("rolId") ?? ""), ...datosDelForm(formData) });
    return { status: "success", message: "Rol actualizado.", rolId: result.rolId };
  } catch (error) {
    return fromError(error, "No se pudo guardar el rol.");
  }
}

export async function eliminarRolAction(_prevState: RolActionState, formData: FormData): Promise<RolActionState> {
  try {
    await eliminarRol({ rolId: String(formData.get("rolId") ?? "") });
    return { status: "success", message: "Rol eliminado." };
  } catch (error) {
    return fromError(error, "No se pudo eliminar el rol.");
  }
}
