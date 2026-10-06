"use server";

/** Server Actions for `/admin/configuracion/etiquetas`. */
import { revalidatePath } from "next/cache";
import { crearEtiquetaTamano } from "@/modules/etiqueta-tamanos/application/crear-etiqueta-tamano";
import { editarEtiquetaTamano } from "@/modules/etiqueta-tamanos/application/editar-etiqueta-tamano";
import { darDeBajaEtiquetaTamano } from "@/modules/etiqueta-tamanos/application/dar-de-baja-etiqueta-tamano";
import { reactivarEtiquetaTamano } from "@/modules/etiqueta-tamanos/application/reactivar-etiqueta-tamano";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import type { EtiquetaTamanoActionState } from "./action-state";

const LISTA_PATH = "/admin/configuracion/etiquetas";

function fromError(error: unknown, fallback: string): EtiquetaTamanoActionState {
  if (error instanceof StepUpRequiredError) return { status: "reauth-required" };
  return actionError(error, fallback);
}

export async function crearEtiquetaTamanoAction(_prevState: EtiquetaTamanoActionState, formData: FormData): Promise<EtiquetaTamanoActionState> {
  try {
    await crearEtiquetaTamano({
      nombre: String(formData.get("nombre") ?? ""),
      anchoMm: String(formData.get("anchoMm") ?? ""),
      altoMm: String(formData.get("altoMm") ?? ""),
    });
    revalidatePath(LISTA_PATH);
    return { status: "success", message: "Tamaño creado." };
  } catch (error) {
    return fromError(error, "No se pudo crear el tamaño.");
  }
}

export async function editarEtiquetaTamanoAction(_prevState: EtiquetaTamanoActionState, formData: FormData): Promise<EtiquetaTamanoActionState> {
  try {
    await editarEtiquetaTamano({
      id: String(formData.get("id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      anchoMm: String(formData.get("anchoMm") ?? ""),
      altoMm: String(formData.get("altoMm") ?? ""),
    });
    revalidatePath(LISTA_PATH);
    return { status: "success", message: "Tamaño actualizado." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

export async function darDeBajaEtiquetaTamanoAction(_prevState: EtiquetaTamanoActionState, formData: FormData): Promise<EtiquetaTamanoActionState> {
  try {
    await darDeBajaEtiquetaTamano({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath(LISTA_PATH);
    return { status: "success", message: "Tamaño dado de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja el tamaño.");
  }
}

export async function reactivarEtiquetaTamanoAction(_prevState: EtiquetaTamanoActionState, formData: FormData): Promise<EtiquetaTamanoActionState> {
  try {
    await reactivarEtiquetaTamano({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath(LISTA_PATH);
    return { status: "success", message: "Tamaño reactivado." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar el tamaño.");
  }
}
