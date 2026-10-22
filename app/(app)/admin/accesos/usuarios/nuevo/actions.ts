"use server";

/**
 * Server Action for `/admin/accesos/usuarios/nuevo` (M03, FASE 3 point 3.2).
 *
 * M2 (security review) made `crearUsuarioCommand` declare
 * `requireRecentReauth`; since the 2026-10-21 decision it no longer does, so
 * the `"reauth-required"` branch below is never reached today. It stays (as in
 * `modules/usuarios/ui/actions.ts`'s `fromError`) because it is harmless --
 * this page isn't wired through `ReauthAwareForm`, and duplicates the two-line
 * check rather than importing a helper from a sibling module's `ui/` (module
 * boundary). On success it redirects to the new usuario's detail page; the
 * temporary password the Administrador typed is never echoed back.
 */
import { redirect } from "next/navigation";
import { crearUsuario } from "@/modules/usuarios/application/crear-usuario";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";

export interface CrearUsuarioFormState {
  status: "idle" | "error" | "reauth-required" | "success";
  message: string | null;
  /** Error only: the form fields the error is about (see `shared/ui/action-error.ts`). */
  fields?: string[];
}

export async function crearUsuarioAction(_prevState: CrearUsuarioFormState, formData: FormData): Promise<CrearUsuarioFormState> {
  // Passed through raw: crearUsuario validates each code against the session tenant's roles (DP-03).
  const roles = formData.getAll("roles").map(String);

  let usuarioId: string;
  try {
    const result = await crearUsuario({
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      email: String(formData.get("email") ?? ""),
      dni: String(formData.get("dni") ?? ""),
      numeroMatricula: String(formData.get("numeroMatricula") ?? "").trim() || undefined,
      roles,
      esSector: formData.get("esSector") === "on",
      passwordTemporal: String(formData.get("passwordTemporal") ?? ""),
      passwordTemporalRepeat: String(formData.get("passwordTemporalRepeat") ?? ""),
    });
    usuarioId = result.usuarioId;
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required", message: null };
    }
    return actionError(error, "No se pudo crear el usuario.");
  }

  // Outside the try/catch: redirect() works by throwing.
  redirect(`/admin/accesos/usuarios/${usuarioId}?creado=1`);
}
