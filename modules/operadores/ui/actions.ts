"use server";

/** Server Actions of `modules/operadores` (docs/specs/cuentas-de-sector.md): the operador prompt's selector and `/admin/configuracion/pin`. */
import { revalidatePath } from "next/cache";
import { configurarAccionesConPin } from "@/modules/operadores/application/configurar-acciones-con-pin";
import { listOperadores } from "@/modules/operadores/application/list-operadores";
import type { ConfigurarAccionesConPinInput } from "@/modules/operadores/application/configurar-acciones-con-pin";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";
import type { AccionesConPinActionState, OperadoresState } from "./action-state";

/** The empleados a cuenta de sector can pick. Called when the prompt opens, not a `<form action>`. Writes nothing. */
export async function listarOperadoresAction(): Promise<OperadoresState> {
  try {
    return { status: "success", operadores: await listOperadores() };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudo leer la lista de empleados.") };
  }
}

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
