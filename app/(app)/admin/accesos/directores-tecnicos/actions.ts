"use server";

/** Server Action for `/admin/accesos/directores-tecnicos` (M04, FASE 3 point 3.9): the cese form on the list page. */
import { cesarDesignacion } from "@/modules/directores-tecnicos/application/cesar-designacion";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import type { DtActionState } from "@/modules/directores-tecnicos/ui/action-state";

export async function cesarDesignacionAction(_prevState: DtActionState, formData: FormData): Promise<DtActionState> {
  try {
    await cesarDesignacion({
      designacionId: String(formData.get("designacionId") ?? ""),
      vigenteHasta: String(formData.get("vigenteHasta") ?? ""),
      motivoCese: String(formData.get("motivoCese") ?? ""),
    });
    return { status: "success", message: "Cese registrado." };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo registrar el cese.");
  }
}
