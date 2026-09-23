"use server";

/** Server Actions for `/admin/usuarios/[id]` (M03, FASE 3 points 3.3-3.6). */
import { editarUsuario } from "@/modules/usuarios/application/editar-usuario";
import { cambiarRoles } from "@/modules/usuarios/application/cambiar-roles";
import { suspenderUsuario } from "@/modules/usuarios/application/suspender-usuario";
import { reactivarUsuario } from "@/modules/usuarios/application/reactivar-usuario";
import { darDeBajaUsuario } from "@/modules/usuarios/application/dar-de-baja-usuario";
import { restablecerCredencial } from "@/modules/usuarios/application/restablecer-credencial";
import { AppError, StepUpRequiredError } from "@/shared/errors";
import { ROLES_ASIGNABLES } from "@/modules/usuarios/domain/roles";
import type { UsuarioActionState } from "@/modules/usuarios/ui/action-state";

/**
 * Narrower than `UsuarioActionState` on purpose: this is a SUBTYPE of both
 * `UsuarioActionState` and `RestablecerCredencialState` (below), so it can
 * be returned from either kind of action without widening the caller's
 * declared return type to include shapes (like the generic `"success"`
 * with only an optional `message`) that `RestablecerCredencialState`
 * deliberately does not have.
 */
type FailureState = { status: "reauth-required" } | { status: "error"; message: string };

function fromError(error: unknown, fallback: string): FailureState {
  if (error instanceof StepUpRequiredError) {
    return { status: "reauth-required" };
  }
  if (error instanceof AppError) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: fallback };
}

export async function editarUsuarioAction(_prevState: UsuarioActionState, formData: FormData): Promise<UsuarioActionState> {
  try {
    await editarUsuario({
      id: String(formData.get("id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      email: String(formData.get("email") ?? ""),
      dni: String(formData.get("dni") ?? ""),
      numeroMatricula: String(formData.get("numeroMatricula") ?? "").trim() || undefined,
      version: {
        nombre: String(formData.get("versionNombre") ?? ""),
        apellido: String(formData.get("versionApellido") ?? ""),
        email: String(formData.get("versionEmail") ?? ""),
        dni: String(formData.get("versionDni") ?? ""),
        numeroMatricula: String(formData.get("versionNumeroMatricula") ?? "") || null,
      },
    });
    return { status: "success", message: "Datos actualizados." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los datos.");
  }
}

export async function cambiarRolesAction(_prevState: UsuarioActionState, formData: FormData): Promise<UsuarioActionState> {
  const roles = formData.getAll("roles").map(String).filter((value) => (ROLES_ASIGNABLES as readonly string[]).includes(value));
  try {
    await cambiarRoles({ usuarioId: String(formData.get("usuarioId") ?? ""), roles: roles as (typeof ROLES_ASIGNABLES)[number][] });
    return { status: "success", message: "Roles actualizados." };
  } catch (error) {
    return fromError(error, "No se pudieron actualizar los roles.");
  }
}

export async function suspenderUsuarioAction(_prevState: UsuarioActionState, formData: FormData): Promise<UsuarioActionState> {
  try {
    await suspenderUsuario({ usuarioId: String(formData.get("usuarioId") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    return { status: "success", message: "Usuario suspendido." };
  } catch (error) {
    return fromError(error, "No se pudo suspender el usuario.");
  }
}

export async function reactivarUsuarioAction(_prevState: UsuarioActionState, formData: FormData): Promise<UsuarioActionState> {
  try {
    await reactivarUsuario({ usuarioId: String(formData.get("usuarioId") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    return { status: "success", message: "Usuario reactivado." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar el usuario.");
  }
}

export async function darDeBajaUsuarioAction(_prevState: UsuarioActionState, formData: FormData): Promise<UsuarioActionState> {
  try {
    await darDeBajaUsuario({ usuarioId: String(formData.get("usuarioId") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    return { status: "success", message: "Usuario dado de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja al usuario.");
  }
}

export type RestablecerCredencialState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "reauth-required" }
  | { status: "success"; credencial: string; credencialVenceEn: string };

export async function restablecerCredencialAction(_prevState: RestablecerCredencialState, formData: FormData): Promise<RestablecerCredencialState> {
  try {
    const result = await restablecerCredencial(String(formData.get("usuarioId") ?? ""));
    return { status: "success", credencial: result.credencial, credencialVenceEn: result.credencialVenceEn.toISOString() };
  } catch (error) {
    return fromError(error, "No se pudo restablecer la credencial.");
  }
}
