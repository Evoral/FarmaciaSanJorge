"use server";

/** Server Actions of `modules/operadores` (openspec/specs/cuentas-de-sector/spec.md): `/admin/configuracion/pin`. */
import { revalidatePath } from "next/cache";
import { configurarAccionesConPin } from "@/modules/operadores/application/configurar-acciones-con-pin";
import type { ConfigurarAccionesConPinInput } from "@/modules/operadores/application/configurar-acciones-con-pin";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import type { AccionesConPinActionState } from "./action-state";

export async function configurarAccionesConPinAction(_prevState: AccionesConPinActionState, formData: FormData): Promise<AccionesConPinActionState> {
  try {
    // Passed through raw: the command only accepts configurable acciones (zod).
    await configurarAccionesConPin({ acciones: formData.getAll("acciones").map(String) as ConfigurarAccionesConPinInput["acciones"] });
    revalidatePath("/admin/configuracion/pin");
    return { status: "success", message: "Configuración guardada. Rige desde la próxima acción de cada cuenta de sector." };
  } catch (error) {
    if (error instanceof StepUpRequiredError) return { status: "reauth-required" };
    return actionError(error, "No se pudo guardar la configuración.");
  }
}
