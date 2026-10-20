"use server";

/**
 * Server Actions for `/catalogos/repartidores`. The ABM is not a PIN action (`repartidores.gestionar` is in neither
 * PERMISOS_CON_PIN_* list), so these do not run inside `conOperador`.
 */
import { revalidatePath } from "next/cache";
import { crearRepartidor } from "@/modules/repartidores/application/crear-repartidor";
import { editarRepartidor } from "@/modules/repartidores/application/editar-repartidor";
import { cambiarEstadoRepartidor } from "@/modules/repartidores/application/cambiar-estado-repartidor";
import { actionError } from "@/shared/ui/action-error";
import type { RepartidorActionState } from "./action-state";

const LISTA_PATH = "/catalogos/repartidores";

export async function crearRepartidorAction(_prevState: RepartidorActionState, formData: FormData): Promise<RepartidorActionState> {
  try {
    await crearRepartidor({
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      telefono: String(formData.get("telefono") ?? ""),
    });
    revalidatePath(LISTA_PATH);
    return { status: "success", message: "Repartidor creado." };
  } catch (error) {
    return actionError(error, "No se pudo crear el repartidor.");
  }
}

export async function editarRepartidorAction(_prevState: RepartidorActionState, formData: FormData): Promise<RepartidorActionState> {
  try {
    await editarRepartidor({
      id: String(formData.get("id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      telefono: String(formData.get("telefono") ?? ""),
    });
    revalidatePath(LISTA_PATH);
    return { status: "success", message: "Repartidor actualizado." };
  } catch (error) {
    return actionError(error, "No se pudieron guardar los cambios.");
  }
}

/** `activo` travels as the string "true" / "false" in a hidden input. */
export async function cambiarEstadoRepartidorAction(_prevState: RepartidorActionState, formData: FormData): Promise<RepartidorActionState> {
  const activo = String(formData.get("activo") ?? "") === "true";
  try {
    await cambiarEstadoRepartidor({ id: String(formData.get("id") ?? ""), activo });
    revalidatePath(LISTA_PATH);
    return { status: "success", message: activo ? "Repartidor activado." : "Repartidor desactivado." };
  } catch (error) {
    return actionError(error, activo ? "No se pudo activar el repartidor." : "No se pudo desactivar el repartidor.");
  }
}
