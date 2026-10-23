"use server";

/** Server Actions for `/admin/configuracion/farmacia` (FASE 3 point 3.10a; the logo, docs/specs/logo-farmacia.md). */
import { editarDatosTenant } from "@/modules/farmacia/application/editar-datos-tenant";
import { cambiarLogoTenant } from "@/modules/farmacia/application/cambiar-logo-tenant";
import { quitarLogoTenant } from "@/modules/farmacia/application/quitar-logo-tenant";
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
      telefonoFijo: String(formData.get("telefonoFijo") ?? "").trim() || undefined,
      telefonoCelular: String(formData.get("telefonoCelular") ?? "").trim() || undefined,
    });
    return { status: "success", message: "Datos actualizados." };
  } catch (error) {
    if (error instanceof StepUpRequiredError) return { status: "reauth-required" };
    return actionError(error, "No se pudieron guardar los datos.");
  }
}

export async function cambiarLogoTenantAction(_prevState: FarmaciaActionState, formData: FormData): Promise<FarmaciaActionState> {
  try {
    await cambiarLogoTenant({ archivo: formData.get("logo") });
    return { status: "success", message: "Logo actualizado." };
  } catch (error) {
    return actionError(error, "No se pudo guardar el logo.");
  }
}

export async function quitarLogoTenantAction(): Promise<FarmaciaActionState> {
  try {
    await quitarLogoTenant();
    return { status: "success", message: "Se quitó el logo: se muestra el genérico." };
  } catch (error) {
    return actionError(error, "No se pudo quitar el logo.");
  }
}
