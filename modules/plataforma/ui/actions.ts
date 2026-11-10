"use server";

/**
 * Server Actions for `/plataforma` (openspec/changes/plataforma-superadmin). Thin: each one reaches a use case, and
 * every use case calls `requireSuperAdmin()` first (spec P6) -- the `/plataforma` layout does not protect actions.
 * They live under the `/plataforma` path, so the browser sends the `fsj_plataforma` cookie (Path=/plataforma).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { crearFarmacia } from "../application/crear-farmacia";
import { cambiarEstadoFarmacia } from "../application/cambiar-estado-farmacia";
import { editarContactoFarmacia } from "../application/editar-contacto-farmacia";
import { clearPlataformaCookie, logoutPlataforma, PLATAFORMA_PATH } from "@/shared/auth/plataforma";
import { logErrorForDiagnostics } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import type { PlataformaActionState } from "./action-state";

function texto(formData: FormData, campo: string): string {
  return String(formData.get(campo) ?? "");
}

const CAMPOS_ALTA = [
  "razonSocial",
  "cuit",
  "nombreFantasia",
  "domicilio",
  "matriculaFarmacia",
  "zonaHoraria",
  "contactoNombre",
  "contactoEmail",
  "contactoTelefono",
  "adminEmail",
  "adminNombre",
  "adminApellido",
  "adminDni",
  "adminPasswordTemporal",
] as const;

export async function crearFarmaciaAction(_prev: PlataformaActionState, formData: FormData): Promise<PlataformaActionState> {
  try {
    const input = Object.fromEntries(CAMPOS_ALTA.map((campo) => [campo, texto(formData, campo)]));
    const { tenantId } = await crearFarmacia(input);
    revalidatePath(PLATAFORMA_PATH);
    return { status: "success", message: "Farmacia creada.", tenantId };
  } catch (error) {
    return actionError(error, "No se pudo crear la farmacia.");
  }
}

/** `estado` is the TARGET estado (hidden input); `motivo` is required when suspending. */
export async function cambiarEstadoFarmaciaAction(_prev: PlataformaActionState, formData: FormData): Promise<PlataformaActionState> {
  const estado = texto(formData, "estado");
  try {
    await cambiarEstadoFarmacia({ id: texto(formData, "id"), estado, motivo: texto(formData, "motivo") });
    revalidatePath(PLATAFORMA_PATH, "layout");
    return { status: "success", message: estado === "SUSPENDIDO" ? "Farmacia suspendida." : "Farmacia reactivada." };
  } catch (error) {
    return actionError(error, estado === "SUSPENDIDO" ? "No se pudo suspender la farmacia." : "No se pudo reactivar la farmacia.");
  }
}

export async function editarContactoFarmaciaAction(_prev: PlataformaActionState, formData: FormData): Promise<PlataformaActionState> {
  try {
    await editarContactoFarmacia({
      id: texto(formData, "id"),
      contactoNombre: texto(formData, "contactoNombre"),
      contactoEmail: texto(formData, "contactoEmail"),
      contactoTelefono: texto(formData, "contactoTelefono"),
    });
    revalidatePath(PLATAFORMA_PATH, "layout");
    return { status: "success", message: "Contacto actualizado." };
  } catch (error) {
    return actionError(error, "No se pudo guardar el contacto.");
  }
}

/** Leaving always works: if the revoke fails (database down), the cookie is still expired and the session dies by idle timeout. */
export async function cerrarSesionPlataformaAction(): Promise<void> {
  try {
    await logoutPlataforma();
  } catch (error) {
    logErrorForDiagnostics(error, { origen: "server-action" });
    await clearPlataformaCookie();
  }
  redirect("/login");
}
