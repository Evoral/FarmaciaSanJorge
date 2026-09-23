"use server";

/** Server Actions for `/catalogos/drogas` (FASE 4 point 4.2). */
import { revalidatePath } from "next/cache";
import { crearDroga } from "@/modules/drogas/application/crear-droga";
import { editarDroga } from "@/modules/drogas/application/editar-droga";
import { darDeBajaDroga } from "@/modules/drogas/application/dar-de-baja-droga";
import { reactivarDroga } from "@/modules/drogas/application/reactivar-droga";
import { AppError } from "@/shared/errors";
import type { DrogaActionState } from "./action-state";

function fromError(error: unknown, fallback: string): DrogaActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

export async function crearDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    await crearDroga({
      nombre: String(formData.get("nombre") ?? ""),
      unidadBaseId: String(formData.get("unidadBaseId") ?? ""),
      esControlada: formData.get("esControlada") === "on",
      tipoControl: String(formData.get("tipoControl") ?? "NINGUNO") as never,
      stockMinimo: String(formData.get("stockMinimo") ?? "0"),
    });
    revalidatePath("/catalogos/drogas");
    return { status: "success", message: "Droga creada." };
  } catch (error) {
    return fromError(error, "No se pudo crear la droga.");
  }
}

export async function editarDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    await editarDroga({
      id: String(formData.get("id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      unidadBaseId: String(formData.get("unidadBaseId") ?? ""),
      esControlada: formData.get("esControlada") === "on",
      tipoControl: String(formData.get("tipoControl") ?? "NINGUNO") as never,
      stockMinimo: String(formData.get("stockMinimo") ?? "0"),
      version: {
        nombre: String(formData.get("versionNombre") ?? ""),
        unidadBaseId: String(formData.get("versionUnidadBaseId") ?? ""),
        esControlada: String(formData.get("versionEsControlada") ?? "") === "true",
        tipoControl: String(formData.get("versionTipoControl") ?? "") as never,
        stockMinimo: String(formData.get("versionStockMinimo") ?? ""),
      },
    });
    revalidatePath("/catalogos/drogas");
    return { status: "success", message: "Droga actualizada." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

export async function darDeBajaDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    await darDeBajaDroga({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/drogas");
    return { status: "success", message: "Droga dada de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja la droga.");
  }
}

export async function reactivarDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    await reactivarDroga({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/drogas");
    return { status: "success", message: "Droga reactivada." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar la droga.");
  }
}
