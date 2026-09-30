"use server";

/** Server Action for `/admin/configuracion/farmacia` (FASE 3 point 3.10a). */
import { editarDatosTenant } from "@/modules/farmacia/application/editar-datos-tenant";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import type { FarmaciaActionState } from "./action-state";

export async function editarDatosTenantAction(_prevState: FarmaciaActionState, formData: FormData): Promise<FarmaciaActionState> {
  try {
    await editarDatosTenant({
      razonSocial: String(formData.get("razonSocial") ?? ""),
      nombreFantasia: String(formData.get("nombreFantasia") ?? "").trim() || undefined,
      domicilio: String(formData.get("domicilio") ?? "").trim() || undefined,
      matriculaFarmacia: String(formData.get("matriculaFarmacia") ?? "").trim() || undefined,
    });
    return { status: "success", message: "Datos actualizados." };
  } catch (error) {
    if (error instanceof StepUpRequiredError) return { status: "reauth-required" };
    return actionError(error, "No se pudieron guardar los datos.");
  }
}
