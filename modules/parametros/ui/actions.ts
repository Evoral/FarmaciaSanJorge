"use server";

/** Server Action for `/admin/parametros` (FASE 3 point 3.10b). */
import { editarParametro } from "@/modules/parametros/application/editar-parametro";
import { isParametroClave } from "@/modules/parametros/domain/parametros-registry";
import { AppError, StepUpRequiredError } from "@/shared/errors";
import type { ParametrosActionState } from "./action-state";

export async function editarParametroAction(_prevState: ParametrosActionState, formData: FormData): Promise<ParametrosActionState> {
  const claveRaw = String(formData.get("clave") ?? "");
  if (!isParametroClave(claveRaw)) {
    return { status: "error", message: "Parámetro desconocido." };
  }

  try {
    await editarParametro({ clave: claveRaw, valor: String(formData.get("valor") ?? "") });
    return { status: "success", message: "Parámetro actualizado." };
  } catch (error) {
    if (error instanceof StepUpRequiredError) return { status: "reauth-required" };
    if (error instanceof AppError) return { status: "error", message: error.message };
    return { status: "error", message: "No se pudo guardar el parámetro." };
  }
}
