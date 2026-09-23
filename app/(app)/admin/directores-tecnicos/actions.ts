"use server";

/** Server Action for `/admin/directores-tecnicos` (M04, FASE 3 point 3.9): the cese form on the list page. */
import { cesarDesignacion } from "@/modules/directores-tecnicos/application/cesar-designacion";
import { AppError, StepUpRequiredError } from "@/shared/errors";
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
    if (error instanceof AppError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "No se pudo registrar el cese." };
  }
}
