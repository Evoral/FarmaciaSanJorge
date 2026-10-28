"use server";

/** Server Action for `/configurar-pin` (openspec/specs/contrasena-temporal/spec.md, step 2). */
import { redirect } from "next/navigation";
import { configurarPinObligatorio } from "@/modules/auth/application/configurar-pin-obligatorio";
import { actionError } from "@/shared/ui/action-error";
import type { FormActionState } from "@/shared/ui/form-parts";

export async function configurarPinObligatorioAction(_prevState: FormActionState, formData: FormData): Promise<FormActionState> {
  const pin = String(formData.get("pin") ?? "");
  const pinRepeat = String(formData.get("pinRepeat") ?? "");

  try {
    await configurarPinObligatorio(pin, pinRepeat);
  } catch (error) {
    return actionError(error, "No se pudo configurar el PIN.");
  }
  // Outside the try: `redirect` throws.
  redirect("/");
}
