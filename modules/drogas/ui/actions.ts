"use server";

/** Server Actions for `/catalogos/drogas` (FASE 4 point 4.2). */
import { revalidatePath } from "next/cache";
import { crearDroga } from "@/modules/drogas/application/crear-droga";
import { editarDroga } from "@/modules/drogas/application/editar-droga";
import { darDeBajaDroga } from "@/modules/drogas/application/dar-de-baja-droga";
import { reactivarDroga } from "@/modules/drogas/application/reactivar-droga";
import { actionError } from "@/shared/ui/action-error";
import type { DrogaActionState } from "./action-state";

/**
 * Disabled fields are not submitted: a missing field is sent as `undefined`
 * so the command keeps the stored value. `esControlada` is never read from
 * the form -- the command derives it from `tipoControl`.
 */
function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return value === null ? undefined : String(value);
}

function fromError(error: unknown, fallback: string): DrogaActionState {
  return actionError(error, fallback);
}

export async function crearDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    await crearDroga({
      nombre: String(formData.get("nombre") ?? ""),
      unidadBaseId: String(formData.get("unidadBaseId") ?? ""),
      tipoControl: optionalField(formData, "tipoControl"),
      clase: optionalField(formData, "clase"),
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
      unidadBaseId: optionalField(formData, "unidadBaseId"),
      tipoControl: optionalField(formData, "tipoControl"),
      clase: optionalField(formData, "clase"),
      stockMinimo: String(formData.get("stockMinimo") ?? "0"),
      version: {
        nombre: String(formData.get("versionNombre") ?? ""),
        unidadBaseId: String(formData.get("versionUnidadBaseId") ?? ""),
        esControlada: String(formData.get("versionEsControlada") ?? "") === "true",
        tipoControl: String(formData.get("versionTipoControl") ?? "") as never,
        clase: String(formData.get("versionClase") ?? ""),
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
