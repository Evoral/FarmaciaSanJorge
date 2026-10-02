"use server";

/**
 * Server Action for `/admin/accesos/usuarios/nuevo` (M03, FASE 3 point 3.2).
 *
 * M2 (security review): `crearUsuarioCommand` now declares
 * `requireRecentReauth` (creating a user mints a credential -- same
 * sensitivity as suspender/reactivar/baja/restablecerCredencial/
 * cambiarRoles), so this action must surface `StepUpRequiredError` as a
 * `"reauth-required"` state, exactly like `modules/usuarios/ui/actions.ts`'s
 * `fromError` does for the OTHER sensitive usuarios actions -- this page
 * predates that shared helper (it has its own richer success state, with
 * the one-time credential) and isn't wired through `ReauthAwareForm`, so
 * the same two-line check is duplicated here rather than importing a
 * helper from a sibling module's `ui/` (module boundary).
 */
import { crearUsuario } from "@/modules/usuarios/application/crear-usuario";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";

export interface CrearUsuarioFormState {
  status: "idle" | "error" | "reauth-required" | "success";
  message: string | null;
  /** Error only: the form fields the error is about (see `shared/ui/action-error.ts`). */
  fields?: string[];
  credencial?: string;
  credencialVenceEn?: string;
  usuarioId?: string;
}

export async function crearUsuarioAction(_prevState: CrearUsuarioFormState, formData: FormData): Promise<CrearUsuarioFormState> {
  // Passed through raw: crearUsuario validates each code against the session tenant's roles (DP-03).
  const roles = formData.getAll("roles").map(String);

  try {
    const result = await crearUsuario({
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      email: String(formData.get("email") ?? ""),
      dni: String(formData.get("dni") ?? ""),
      numeroMatricula: String(formData.get("numeroMatricula") ?? "").trim() || undefined,
      roles,
    });

    return {
      status: "success",
      message: null,
      credencial: result.credencial,
      credencialVenceEn: result.credencialVenceEn.toISOString(),
      usuarioId: result.usuarioId,
    };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required", message: null };
    }
    return actionError(error, "No se pudo crear el usuario.");
  }
}
