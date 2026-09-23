"use server";

/** Server Actions for `/catalogos/proveedores` (FASE 4 point 4.3). */
import { revalidatePath } from "next/cache";
import { crearProveedor } from "@/modules/proveedores/application/crear-proveedor";
import { editarProveedor } from "@/modules/proveedores/application/editar-proveedor";
import { darDeBajaProveedor } from "@/modules/proveedores/application/dar-de-baja-proveedor";
import { reactivarProveedor } from "@/modules/proveedores/application/reactivar-proveedor";
import { AppError } from "@/shared/errors";
import type { ProveedorActionState } from "./action-state";

function fromError(error: unknown, fallback: string): ProveedorActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

export async function crearProveedorAction(_prevState: ProveedorActionState, formData: FormData): Promise<ProveedorActionState> {
  try {
    await crearProveedor({ razonSocial: String(formData.get("razonSocial") ?? ""), cuit: String(formData.get("cuit") ?? "") });
    revalidatePath("/catalogos/proveedores");
    return { status: "success", message: "Proveedor creado." };
  } catch (error) {
    return fromError(error, "No se pudo crear el proveedor.");
  }
}

export async function editarProveedorAction(_prevState: ProveedorActionState, formData: FormData): Promise<ProveedorActionState> {
  try {
    await editarProveedor({
      id: String(formData.get("id") ?? ""),
      razonSocial: String(formData.get("razonSocial") ?? ""),
      cuit: String(formData.get("cuit") ?? ""),
      version: {
        razonSocial: String(formData.get("versionRazonSocial") ?? ""),
        cuit: String(formData.get("versionCuit") ?? ""),
      },
    });
    revalidatePath("/catalogos/proveedores");
    return { status: "success", message: "Proveedor actualizado." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

export async function darDeBajaProveedorAction(_prevState: ProveedorActionState, formData: FormData): Promise<ProveedorActionState> {
  try {
    await darDeBajaProveedor({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/proveedores");
    return { status: "success", message: "Proveedor dado de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja al proveedor.");
  }
}

export async function reactivarProveedorAction(_prevState: ProveedorActionState, formData: FormData): Promise<ProveedorActionState> {
  try {
    await reactivarProveedor({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/proveedores");
    return { status: "success", message: "Proveedor reactivado." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar al proveedor.");
  }
}
