"use server";

/** Server Actions for `/catalogos/unidades` (FASE 4 point 4.1). */
import { revalidatePath } from "next/cache";
import { crearUnidad } from "@/modules/unidades/application/crear-unidad";
import { editarUnidad } from "@/modules/unidades/application/editar-unidad";
import { darDeBajaUnidad } from "@/modules/unidades/application/dar-de-baja-unidad";
import { reactivarUnidad } from "@/modules/unidades/application/reactivar-unidad";
import { actionError } from "@/shared/ui/action-error";
import type { UnidadActionState } from "./action-state";

function fromError(error: unknown, fallback: string): UnidadActionState {
  return actionError(error, fallback);
}

export async function crearUnidadAction(_prevState: UnidadActionState, formData: FormData): Promise<UnidadActionState> {
  try {
    await crearUnidad({
      codigo: String(formData.get("codigo") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      simbolo: String(formData.get("simbolo") ?? ""),
      tipoMagnitud: String(formData.get("tipoMagnitud") ?? "") as never,
      factorABase: String(formData.get("factorABase") ?? ""),
      esBase: formData.get("esBase") === "on",
    });
    revalidatePath("/catalogos/unidades");
    return { status: "success", message: "Unidad creada." };
  } catch (error) {
    return fromError(error, "No se pudo crear la unidad.");
  }
}

export async function editarUnidadAction(_prevState: UnidadActionState, formData: FormData): Promise<UnidadActionState> {
  try {
    await editarUnidad({
      id: String(formData.get("id") ?? ""),
      codigo: String(formData.get("codigo") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      simbolo: String(formData.get("simbolo") ?? ""),
      tipoMagnitud: String(formData.get("tipoMagnitud") ?? "") as never,
      factorABase: String(formData.get("factorABase") ?? ""),
      version: {
        codigo: String(formData.get("versionCodigo") ?? ""),
        nombre: String(formData.get("versionNombre") ?? ""),
        simbolo: String(formData.get("versionSimbolo") ?? ""),
        tipoMagnitud: String(formData.get("versionTipoMagnitud") ?? "") as never,
        factorABase: String(formData.get("versionFactorABase") ?? ""),
      },
    });
    revalidatePath("/catalogos/unidades");
    return { status: "success", message: "Unidad actualizada." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

export async function darDeBajaUnidadAction(_prevState: UnidadActionState, formData: FormData): Promise<UnidadActionState> {
  try {
    await darDeBajaUnidad({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/unidades");
    return { status: "success", message: "Unidad dada de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja la unidad.");
  }
}

export async function reactivarUnidadAction(_prevState: UnidadActionState, formData: FormData): Promise<UnidadActionState> {
  try {
    await reactivarUnidad({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/unidades");
    return { status: "success", message: "Unidad reactivada." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar la unidad.");
  }
}
