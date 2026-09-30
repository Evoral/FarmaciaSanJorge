"use server";

/** Server Actions for `/archivo/**` (FASE 12). */
import { revalidatePath } from "next/cache";
import { conformarLote } from "@/modules/archivo/application/conformar-lote";
import { actualizarPlazos } from "@/modules/archivo/application/actualizar-plazos";
import { solicitarDestruccion } from "@/modules/archivo/application/solicitar-destruccion";
import { autorizarDestruccion } from "@/modules/archivo/application/autorizar-destruccion";
import { registrarDestruccion } from "@/modules/archivo/application/registrar-destruccion";
import { actionError } from "@/shared/ui/action-error";
import type { ArchivoActionState } from "./action-state";

export async function conformarLoteAction(_prevState: ArchivoActionState, formData: FormData): Promise<ArchivoActionState> {
  try {
    const resultado = await conformarLote({
      periodoDesde: String(formData.get("periodoDesde") ?? ""),
      periodoHasta: String(formData.get("periodoHasta") ?? ""),
      ubicacion: String(formData.get("ubicacion") ?? ""),
    });
    revalidatePath("/archivo");
    revalidatePath(`/archivo/${resultado.id}`);
    return { status: "success", message: `Lote Nº ${resultado.numero} conformado con ${resultado.cantidadRecetas} receta${resultado.cantidadRecetas === 1 ? "" : "s"}.` };
  } catch (error) {
    return actionError(error, "No se pudo conformar el lote.");
  }
}

export async function actualizarPlazosAction(_prevState: ArchivoActionState, _formData: FormData): Promise<ArchivoActionState> {
  void _prevState;
  void _formData;
  try {
    const resultado = await actualizarPlazos();
    revalidatePath("/archivo");
    return { status: "success", message: resultado.cantidad === 0 ? "No hay lotes que hayan cumplido el plazo." : `${resultado.cantidad} lote${resultado.cantidad === 1 ? "" : "s"} pasaron a Plazo cumplido.` };
  } catch (error) {
    return actionError(error, "No se pudieron actualizar los plazos.");
  }
}

export async function solicitarDestruccionAction(_prevState: ArchivoActionState, formData: FormData): Promise<ArchivoActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    await solicitarDestruccion({ id, password: String(formData.get("password") ?? "") });
    revalidatePath(`/archivo/${id}`);
    revalidatePath("/archivo");
    return { status: "success", message: "Destrucción solicitada." };
  } catch (error) {
    return actionError(error, "No se pudo solicitar la destrucción.");
  }
}

export async function autorizarDestruccionAction(_prevState: ArchivoActionState, formData: FormData): Promise<ArchivoActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    await autorizarDestruccion({
      id,
      expedienteAutorizacion: String(formData.get("expedienteAutorizacion") ?? ""),
      fechaAutorizacion: String(formData.get("fechaAutorizacion") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    revalidatePath(`/archivo/${id}`);
    revalidatePath("/archivo");
    return { status: "success", message: "Destrucción autorizada." };
  } catch (error) {
    return actionError(error, "No se pudo autorizar la destrucción.");
  }
}

export async function registrarDestruccionAction(_prevState: ArchivoActionState, formData: FormData): Promise<ArchivoActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    await registrarDestruccion({
      id,
      fechaDestruccion: String(formData.get("fechaDestruccion") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    revalidatePath(`/archivo/${id}`);
    revalidatePath("/archivo");
    return { status: "success", message: "Destrucción registrada. Se destruyeron solo las recetas en papel de este lote; los registros digitales se conservan." };
  } catch (error) {
    return actionError(error, "No se pudo registrar la destrucción.");
  }
}
