"use server";

/** Server Action for `/cambiar-password` (docs/specs/contrasena-temporal.md, step 1). */
import { redirect } from "next/navigation";
import { cambiarPasswordTemporal } from "@/modules/auth/application/cambiar-password-temporal";
import { actionError } from "@/shared/ui/action-error";
import type { FormActionState } from "@/shared/ui/form-parts";

export async function cambiarPasswordTemporalAction(_prevState: FormActionState, formData: FormData): Promise<FormActionState> {
  const nueva = String(formData.get("nueva") ?? "");
  const nuevaRepeat = String(formData.get("nuevaRepeat") ?? "");

  try {
    await cambiarPasswordTemporal(nueva, nuevaRepeat);
  } catch (error) {
    return actionError(error, "No se pudo cambiar la contraseña.");
  }
  // Outside the try: `redirect` throws. `app/(app)/layout.tsx` forwards to the PIN step when it is still pending.
  redirect("/");
}
